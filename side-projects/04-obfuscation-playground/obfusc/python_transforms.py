"""Composable AST transforms for Python source, built on the standard ast module.

Every transform is a function ``transform(tree, rng, options) -> tree`` that
mutates and returns an ``ast.Module`` tree. Transforms are registered in
``REGISTRY`` with a name, a description, and a small options schema so the UI
and CLI can present them uniformly.

The transforms are written to preserve runtime behaviour: the goal is to make
code harder to read, not to change what it does. See ``equivalence_check`` and
the test suite for the guarantees that hold on the bundled examples.
"""

from __future__ import annotations

import ast
import builtins as _builtins
import base64
import keyword

# Names we must never rename: Python builtins and keywords.
_BUILTIN_NAMES = set(dir(_builtins)) | set(keyword.kwlist) | {
    "self",
    "cls",
    "__name__",
    "__file__",
    "__doc__",
}


# --------------------------------------------------------------------------- #
# Small shared helpers
# --------------------------------------------------------------------------- #
def _fresh(rng, prefix="_v"):
    """A source-unique name unlikely to collide with anything in the snippet."""
    return "{}{:04x}".format(prefix, rng.randrange(0x10000))


def _iter_bodies(tree):
    """Yield (node, field, block) for every statement list in the tree.

    Useful for transforms that insert statements. Callers decide which blocks
    to skip (dead-code insertion skips class bodies, for example).
    """
    for node in ast.walk(tree):
        for field in ("body", "orelse", "finalbody"):
            block = getattr(node, field, None)
            if isinstance(block, list) and block and all(
                isinstance(s, ast.stmt) for s in block
            ):
                yield node, field, block


# --------------------------------------------------------------------------- #
# 1. rename_identifiers
# --------------------------------------------------------------------------- #
# Adversarial pools: names that actively suggest the wrong meaning.
_ADV_VARS = [
    "total_price", "is_valid", "user_count", "temp_buffer", "cache_hit",
    "retry_limit", "error_flag", "config_path", "session_id", "byte_offset",
    "row_index", "is_ready", "max_depth", "output_lines", "checksum",
    "timeout_ms", "parent_node", "raw_payload", "delta_x", "sort_key",
]
_ADV_FUNCS = [
    "normalize", "validate", "flush", "encrypt", "shuffle", "reconnect",
    "sanitize", "rollback", "authenticate", "compress", "dispatch", "render",
    "prefetch", "serialize", "migrate", "handshake", "throttle", "resolve",
]
_LOOKALIKE = ["l", "I", "O", "ll", "II", "OO", "lI", "Il", "O0", "l1", "I1"]


def _param_names(args):
    params = list(args.posonlyargs) + list(args.args) + list(args.kwonlyargs)
    if args.vararg:
        params.append(args.vararg)
    if args.kwarg:
        params.append(args.kwarg)
    return [a.arg for a in params]


class _RenameCollector(ast.NodeVisitor):
    """Collect renameable names and names that must stay fixed.

    A name is renameable when it is bound locally in the snippet (assignment
    target, loop variable, function or class name). A name is excluded
    everywhere if it is a builtin, an imported name, a method name, or a dunder.
    Excluding a name in one place excludes it in all places, which keeps a
    single consistent rename map safe across scopes.

    Parameters are handled with more care. A parameter can only be renamed if
    every function that uses it as a parameter is a plain module or nested
    function whose own name we can rename, so that we can rewrite the matching
    keyword arguments at every internal call site. Parameters of methods and
    lambdas (whose call sites we cannot always see) are never renamed.
    """

    def __init__(self):
        self.candidates = set()      # names bound locally (not parameters)
        self.excluded = set(_BUILTIN_NAMES)
        self.func_names = set()      # module / nested function names
        # param name -> set of owner keys; owner is ("func", name) for a plain
        # function, or a sentinel string for a method or lambda.
        self.param_owner = {}
        self._class_depth = 0

    def _add_param_owner(self, name, owner):
        self.param_owner.setdefault(name, set()).add(owner)

    def visit_Import(self, node):
        for alias in node.names:
            name = (alias.asname or alias.name).split(".")[0]
            self.excluded.add(name)
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        for alias in node.names:
            self.excluded.add(alias.asname or alias.name)
        self.generic_visit(node)

    def _handle_function(self, node):
        in_class = self._class_depth > 0
        if in_class:
            # Method name is reached through attribute access; leave it alone.
            self.excluded.add(node.name)
            owner = "<method>"
        else:
            self.candidates.add(node.name)
            self.func_names.add(node.name)
            owner = ("func", node.name)
        for pname in _param_names(node.args):
            self._add_param_owner(pname, owner)
        # A function body is not in a class for the purpose of nested defs.
        prev = self._class_depth
        self._class_depth = 0
        for child in ast.iter_child_nodes(node):
            self.visit(child)
        self._class_depth = prev

    visit_FunctionDef = _handle_function
    visit_AsyncFunctionDef = _handle_function

    def visit_Lambda(self, node):
        for pname in _param_names(node.args):
            self._add_param_owner(pname, "<lambda>")
        self.generic_visit(node)

    def visit_ClassDef(self, node):
        self.candidates.add(node.name)
        self._class_depth += 1
        self.generic_visit(node)
        self._class_depth -= 1

    def visit_Name(self, node):
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self.candidates.add(node.id)
        self.generic_visit(node)

    def visit_Global(self, node):
        self.candidates.update(node.names)
        self.generic_visit(node)

    def visit_Nonlocal(self, node):
        self.candidates.update(node.names)
        self.generic_visit(node)

    def visit_ExceptHandler(self, node):
        if node.name:
            self.candidates.add(node.name)
        self.generic_visit(node)


class _RenameApplier(ast.NodeTransformer):
    def __init__(self, mapping):
        self.mapping = mapping

    def visit_Name(self, node):
        if node.id in self.mapping:
            node.id = self.mapping[node.id]
        return node

    def _rename_def(self, node):
        if node.name in self.mapping:
            node.name = self.mapping[node.name]
        self.generic_visit(node)
        return node

    visit_FunctionDef = _rename_def
    visit_AsyncFunctionDef = _rename_def
    visit_ClassDef = _rename_def

    def visit_arg(self, node):
        if node.arg in self.mapping:
            node.arg = self.mapping[node.arg]
        self.generic_visit(node)
        return node

    def visit_Global(self, node):
        node.names = [self.mapping.get(n, n) for n in node.names]
        return node

    def visit_Nonlocal(self, node):
        node.names = [self.mapping.get(n, n) for n in node.names]
        return node

    def visit_ExceptHandler(self, node):
        if node.name in self.mapping:
            node.name = self.mapping[node.name]
        self.generic_visit(node)
        return node


def transform_rename(tree, rng, options):
    options = options or {}
    mode = options.get("mode", "uninformative")
    style = options.get("style", "sequential")

    collector = _RenameCollector()
    collector.visit(tree)

    base = collector.candidates - collector.excluded
    # Plain functions whose name we can rename, so keyword calls can follow.
    surviving_funcs = {n for n in collector.func_names if n in base}
    surviving_owner_keys = {("func", n) for n in surviving_funcs}

    # A parameter name is renameable only if every function that uses it as a
    # parameter is a surviving plain function. Otherwise exclude it everywhere.
    good_params = set()
    bad_params = set()
    for pname, owners in collector.param_owner.items():
        if owners and owners.issubset(surviving_owner_keys):
            good_params.add(pname)
        else:
            bad_params.add(pname)

    rename_set = sorted(((base | good_params) - bad_params) - collector.excluded)
    if not rename_set:
        return tree
    rename_set_lookup = set(rename_set)
    surviving_funcs = {n for n in surviving_funcs if n in rename_set_lookup}

    # Build the new-name generator.
    mapping = {}
    if mode == "adversarial":
        var_pool = list(_ADV_VARS)
        func_pool = list(_ADV_FUNCS)
        rng.shuffle(var_pool)
        rng.shuffle(func_pool)
        vi = fi = 0
        for name in rename_set:
            if name in collector.func_names:
                new = func_pool[fi % len(func_pool)] + (
                    "" if fi < len(func_pool) else str(fi))
                fi += 1
            else:
                new = var_pool[vi % len(var_pool)] + (
                    "" if vi < len(var_pool) else str(vi))
                vi += 1
            mapping[name] = new
    else:  # uninformative
        if style == "lookalike":
            pool = list(_LOOKALIKE)
            rng.shuffle(pool)
            for i, name in enumerate(rename_set):
                if i < len(pool):
                    mapping[name] = pool[i]
                else:
                    mapping[name] = pool[i % len(pool)] + str(i)
        else:  # sequential a1, b2, c3, ...
            letters = "abcdefghijklmnopqrstuvwxyz"
            order = list(range(len(rename_set)))
            rng.shuffle(order)
            for slot, name in zip(order, rename_set):
                mapping[name] = letters[slot % 26] + str(slot + 1)

    # Guarantee the mapping is injective (no two names collapse into one).
    seen = {}
    for k in list(mapping):
        v = mapping[k]
        while v in seen:
            v = v + "_"
        seen[v] = k
        mapping[k] = v

    applier = _RenameApplier(mapping)
    tree = applier.visit(tree)

    # Rename keyword-argument names of internal calls to match the renamed
    # parameters. Only calls whose callee is a function defined in this snippet
    # are touched, so keyword names of external calls stay intact. By this point
    # callee names have already been rewritten, so we compare against new names.
    internal_func_new = {mapping[f] for f in surviving_funcs}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in internal_func_new:
                for kw in node.keywords:
                    if kw.arg in mapping:
                        kw.arg = mapping[kw.arg]
    ast.fix_missing_locations(tree)
    return tree


# --------------------------------------------------------------------------- #
# 2. control_flow_flatten
# --------------------------------------------------------------------------- #
def _flatten_body(body, rng):
    """Turn a straight sequence of statements into a state-machine while loop.

    Global/nonlocal declarations and a leading docstring are hoisted so scope
    rules and syntax stay valid. Each remaining top-level statement becomes one
    dispatch block that runs, then advances the state counter.
    """
    hoist = []
    rest = []
    for i, stmt in enumerate(body):
        if isinstance(stmt, (ast.Global, ast.Nonlocal)):
            hoist.append(stmt)
        else:
            rest.append(stmt)
    if len(rest) < 2:
        return None  # nothing worth flattening

    state = _fresh(rng, "_state_")
    branches = []
    for i, stmt in enumerate(rest):
        test = ast.Compare(
            left=ast.Name(id=state, ctx=ast.Load()),
            ops=[ast.Eq()],
            comparators=[ast.Constant(value=i)],
        )
        advance = ast.Assign(
            targets=[ast.Name(id=state, ctx=ast.Store())],
            value=ast.Constant(value=i + 1),
        )
        branches.append((test, [stmt, advance]))

    # Build nested if/elif ... else: break from the last branch upward.
    else_body = [ast.Break()]
    dispatch = None
    for test, block in reversed(branches):
        dispatch = ast.If(test=test, body=block, orelse=else_body)
        else_body = [dispatch]

    loop = ast.While(
        test=ast.Constant(value=True),
        body=[dispatch],
        orelse=[],
    )
    init = ast.Assign(
        targets=[ast.Name(id=state, ctx=ast.Store())],
        value=ast.Constant(value=0),
    )
    return hoist + [init, loop]


def _body_is_flattenable(body):
    for stmt in body:
        if isinstance(stmt, (ast.Try, ast.With, ast.AsyncWith)):
            return False
    return True


def transform_flatten(tree, rng, options):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if not _body_is_flattenable(node.body):
                continue
            new_body = _flatten_body(node.body, rng)
            if new_body is not None:
                node.body = new_body
    ast.fix_missing_locations(tree)
    return tree


# --------------------------------------------------------------------------- #
# 3. dead_code_insertion
# --------------------------------------------------------------------------- #
def _opaque_false_test(rng):
    """Return an expression AST that always evaluates to False, using literals."""
    choice = rng.randrange(3)
    if choice == 0:
        k = rng.randint(2, 40)
        # k*k < 0 is always false
        return ast.Compare(
            left=ast.BinOp(ast.Constant(k), ast.Mult(), ast.Constant(k)),
            ops=[ast.Lt()],
            comparators=[ast.Constant(0)],
        )
    if choice == 1:
        odd = rng.randrange(1, 50) * 2 + 1
        # (odd % 2) == 0 is always false
        return ast.Compare(
            left=ast.BinOp(ast.Constant(odd), ast.Mod(), ast.Constant(2)),
            ops=[ast.Eq()],
            comparators=[ast.Constant(0)],
        )
    k = rng.randint(1, 30)
    # (k) < (k) - 1 is always false
    return ast.Compare(
        left=ast.Constant(k),
        ops=[ast.Lt()],
        comparators=[ast.BinOp(ast.Constant(k), ast.Sub(), ast.Constant(1))],
    )


def _junk_stmt(rng):
    """A harmless statement assigning to a fresh, unused name."""
    name = _fresh(rng, "_dead_")
    kind = rng.randrange(3)
    if kind == 0:
        value = ast.Constant(rng.randint(-999, 999))
    elif kind == 1:
        a, b = rng.randint(1, 50), rng.randint(1, 50)
        value = ast.BinOp(ast.Constant(a), ast.Add(), ast.Constant(b))
    else:
        value = ast.List(elts=[ast.Constant(rng.randint(0, 9))
                                for _ in range(rng.randint(0, 3))],
                         ctx=ast.Load())
    return ast.Assign(targets=[ast.Name(id=name, ctx=ast.Store())], value=value)


def transform_dead_code(tree, rng, options):
    options = options or {}
    density = float(options.get("density", 0.5))

    # Collect insertion points first so we do not mutate while iterating.
    targets = []
    for parent, field, block in _iter_bodies(tree):
        if isinstance(parent, ast.ClassDef) and field == "body":
            continue  # keep class bodies clean
        targets.append((block,))

    for (block,) in targets:
        # Walk positions from the end so indices stay valid as we insert.
        positions = list(range(len(block) + 1))
        for pos in reversed(positions):
            if rng.random() > density:
                continue
            if rng.random() < 0.5:
                # opaque predicate guarding junk
                guard = ast.If(
                    test=_opaque_false_test(rng),
                    body=[_junk_stmt(rng)],
                    orelse=[],
                )
                block.insert(pos, guard)
            else:
                block.insert(pos, _junk_stmt(rng))

    ast.fix_missing_locations(tree)
    return tree


# --------------------------------------------------------------------------- #
# 4. string_encoding
# --------------------------------------------------------------------------- #
def _protected_string_ids(tree):
    """Collect ids of string Constants that must stay literal.

    Docstrings, f-string literal parts, and match-pattern literals are kept as
    real string literals so behaviour and syntax do not change.
    """
    protected = set()

    # Docstrings: first statement of a module / def / class if it is a string.
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(body, list) and body:
            first = body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
                    and isinstance(first.value.value, str):
                protected.add(id(first.value))

    # f-string parts and match patterns.
    class _Prot(ast.NodeVisitor):
        def visit_JoinedStr(self, n):
            for c in ast.walk(n):
                if isinstance(c, ast.Constant):
                    protected.add(id(c))

        def visit_match_case(self, n):
            for c in ast.walk(n.pattern):
                if isinstance(c, ast.Constant):
                    protected.add(id(c))
            for s in n.body:
                self.visit(s)
            if n.guard:
                self.visit(n.guard)

    _Prot().visit(tree)
    return protected


class _StringEncoder(ast.NodeTransformer):
    def __init__(self, protected, method, helper, xor_key, rng):
        self.protected = protected
        self.method = method
        self.helper = helper
        self.xor_key = xor_key
        self.rng = rng
        self.count = 0

    def visit_Constant(self, node):
        if not isinstance(node.value, str):
            return node
        if id(node) in self.protected:
            return node
        self.count += 1
        text = node.value
        if self.method == "xor":
            data = [b ^ self.xor_key for b in text.encode("utf-8")]
            return ast.Call(
                func=ast.Name(id=self.helper, ctx=ast.Load()),
                args=[ast.List(elts=[ast.Constant(v) for v in data],
                               ctx=ast.Load()),
                      ast.Constant(self.xor_key)],
                keywords=[],
            )
        # base64
        encoded = base64.b64encode(text.encode("utf-8")).decode("ascii")
        return ast.Call(
            func=ast.Name(id=self.helper, ctx=ast.Load()),
            args=[ast.Constant(encoded)],
            keywords=[],
        )


def _string_helper_source(method, helper):
    if method == "xor":
        return (
            "def {h}(data, k):\n"
            "    return ''.join(chr(b ^ k) for b in data)\n"
        ).format(h=helper)
    return (
        "import base64 as _b64x\n"
        "def {h}(s):\n"
        "    return _b64x.b64decode(s).decode('utf-8')\n"
    ).format(h=helper)


def transform_string_encoding(tree, rng, options):
    options = options or {}
    method = options.get("method", "base64")
    helper = _fresh(rng, "_dec_")
    xor_key = rng.randint(1, 255)

    protected = _protected_string_ids(tree)
    encoder = _StringEncoder(protected, method, helper, xor_key, rng)
    tree = encoder.visit(tree)
    if encoder.count == 0:
        return tree

    # Inject the decode helper after any leading docstring / future imports.
    helper_nodes = ast.parse(_string_helper_source(method, helper)).body
    insert_at = 0
    for i, stmt in enumerate(tree.body):
        is_doc = (i == 0 and isinstance(stmt, ast.Expr)
                  and isinstance(stmt.value, ast.Constant)
                  and isinstance(stmt.value.value, str))
        is_future = isinstance(stmt, ast.ImportFrom) and stmt.module == "__future__"
        if is_doc or is_future:
            insert_at = i + 1
        else:
            break
    tree.body[insert_at:insert_at] = helper_nodes
    ast.fix_missing_locations(tree)
    return tree


# --------------------------------------------------------------------------- #
# 5. expression_rewriting
# --------------------------------------------------------------------------- #
def _obfuscate_int(value, rng):
    """Return a BinOp AST equal to the integer ``value``."""
    strategy = rng.randrange(3)
    if strategy == 0:  # a + b
        a = rng.randint(-40, 40)
        b = value - a
        return ast.BinOp(ast.Constant(a), ast.Add(), ast.Constant(b))
    if strategy == 1:  # a - b
        b = rng.randint(-40, 40)
        a = value + b
        return ast.BinOp(ast.Constant(a), ast.Sub(), ast.Constant(b))
    # a ^ b (only for non-negative values)
    if value >= 0:
        a = rng.randint(0, max(1, value + 32))
        b = value ^ a
        return ast.BinOp(ast.Constant(a), ast.BitXor(), ast.Constant(b))
    a = rng.randint(-40, 40)
    return ast.BinOp(ast.Constant(a), ast.Add(), ast.Constant(value - a))


class _ExprRewriter(ast.NodeTransformer):
    def __init__(self, rng, opts):
        self.rng = rng
        self.opts = opts
        self.protected = set()

    def visit_Constant(self, node):
        if not self.opts.get("constants", True):
            return node
        v = node.value
        # bool is a subclass of int; leave True/False alone.
        if isinstance(v, bool) or not isinstance(v, int):
            return node
        if id(node) in self.protected:
            return node
        if abs(v) > 1024:
            return node
        return ast.copy_location(_obfuscate_int(v, self.rng), node)

    def visit_BinOp(self, node):
        self.generic_visit(node)
        # x + intliteral  ->  x - (-intliteral)
        if self.opts.get("add_sub", True) and isinstance(node.op, ast.Add):
            if isinstance(node.right, ast.Constant) and isinstance(
                    node.right.value, int) and not isinstance(node.right.value, bool):
                return ast.BinOp(
                    node.left, ast.Sub(),
                    ast.Constant(-node.right.value))
        # intliteral * 2  ->  intliteral << 1  (provably int)
        if self.opts.get("mul", True) and isinstance(node.op, ast.Mult):
            for a, b in ((node.left, node.right), (node.right, node.left)):
                if isinstance(a, ast.Constant) and isinstance(a.value, int) \
                        and not isinstance(a.value, bool) \
                        and isinstance(b, ast.Constant) and b.value == 2 \
                        and not isinstance(b.value, bool):
                    return ast.BinOp(a, ast.LShift(), ast.Constant(1))
        return node

    def _rewrite_test(self, expr):
        # not (not (expr)) is equivalent in a boolean test position.
        return ast.UnaryOp(ast.Not(), ast.UnaryOp(ast.Not(), expr))

    def visit_If(self, node):
        self.generic_visit(node)
        if self.opts.get("bool", True):
            node.test = self._rewrite_test(node.test)
        return node

    def visit_While(self, node):
        self.generic_visit(node)
        if self.opts.get("bool", True) and not (
                isinstance(node.test, ast.Constant) and node.test.value is True):
            node.test = self._rewrite_test(node.test)
        return node


def transform_expression_rewriting(tree, rng, options):
    options = options or {}
    rewriter = _ExprRewriter(rng, options)
    # Protect integer constants inside match patterns.
    for node in ast.walk(tree):
        if isinstance(node, ast.match_case):
            for c in ast.walk(node.pattern):
                if isinstance(c, ast.Constant):
                    rewriter.protected.add(id(c))
    tree = rewriter.visit(tree)
    ast.fix_missing_locations(tree)
    return tree


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #
REGISTRY = {
    "rename_identifiers": {
        "func": transform_rename,
        "description": "Rename local identifiers. Uninformative names (a1, b2 "
                       "or l/I/O lookalikes) or adversarial names that suggest "
                       "the wrong meaning.",
        "options": {
            "mode": {"type": "enum", "values": ["uninformative", "adversarial"],
                     "default": "uninformative"},
            "style": {"type": "enum", "values": ["sequential", "lookalike"],
                      "default": "sequential",
                      "note": "only used when mode is uninformative"},
        },
    },
    "control_flow_flatten": {
        "func": transform_flatten,
        "description": "Rewrite each function body as a while loop with a state "
                       "variable and an if/elif dispatch. Skips bodies that use "
                       "try or with.",
        "options": {},
    },
    "dead_code_insertion": {
        "func": transform_dead_code,
        "description": "Insert opaque always-false predicates guarding junk and "
                       "unused variable assignments.",
        "options": {
            "density": {"type": "float", "default": 0.5, "min": 0.0, "max": 1.0},
        },
    },
    "string_encoding": {
        "func": transform_string_encoding,
        "description": "Replace string literals with decode calls (base64 or a "
                       "reversible XOR) and inject a small helper at the top.",
        "options": {
            "method": {"type": "enum", "values": ["base64", "xor"],
                       "default": "base64"},
        },
    },
    "expression_rewriting": {
        "func": transform_expression_rewriting,
        "description": "Rewrite expressions: obfuscate small integer constants, "
                       "x+1 into x-(-1), n*2 into n<<1, and boolean identities "
                       "in test positions.",
        "options": {
            "constants": {"type": "bool", "default": True},
            "add_sub": {"type": "bool", "default": True},
            "mul": {"type": "bool", "default": True},
            "bool": {"type": "bool", "default": True},
        },
    },
}

# Short aliases accepted by the CLI and API.
ALIASES = {
    "rename": "rename_identifiers",
    "flatten": "control_flow_flatten",
    "dead_code": "dead_code_insertion",
    "deadcode": "dead_code_insertion",
    "strings": "string_encoding",
    "string": "string_encoding",
    "expr": "expression_rewriting",
    "rewrite": "expression_rewriting",
}


def resolve_name(name):
    """Map an alias or full name to a registry key, or raise KeyError."""
    if name in REGISTRY:
        return name
    if name in ALIASES:
        return ALIASES[name]
    raise KeyError(name)
