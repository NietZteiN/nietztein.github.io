/*
 * JavaScript obfuscation transforms, run entirely in the browser.
 *
 * Uses the vendored acorn (parser), acorn-walk (walker) and astring
 * (generator). The same five transforms as the Python side are implemented.
 * A couple of them are a documented subset because JavaScript scoping and the
 * overloaded "+" operator make the general case unsafe; those limits are noted
 * inline and in the project README.
 *
 * The module works in the browser (reads acorn / acorn.walk / astring from the
 * global scope and exposes window.JSObf) and under Node (require of the vendor
 * files) so it can be unit tested.
 */
(function (root, factory) {
  let acorn, walk, astring;
  if (typeof require === "function" && typeof module !== "undefined") {
    acorn = require("../vendor/acorn.js");
    walk = require("../vendor/walk.js");
    astring = require("../vendor/astring.min.js");
    module.exports = factory(acorn, walk, astring);
  } else {
    acorn = root.acorn;
    walk = root.acorn.walk;
    astring = root.astring;
    root.JSObf = factory(acorn, walk, astring);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (acorn, walk, astring) {
  "use strict";

  const PARSE_OPTS = { ecmaVersion: 2022, sourceType: "script" };

  // ----------------------------------------------------------------------- //
  // Seeded RNG (mulberry32) so the browser output is deterministic.
  // ----------------------------------------------------------------------- //
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) { return mulberry32(hashSeed(String(seed))); }
  function randint(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  function shuffle(rng, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ----------------------------------------------------------------------- //
  // A small post-order AST rewriter that lets a visitor replace a node.
  // ----------------------------------------------------------------------- //
  const SKIP_KEYS = new Set(["type", "start", "end", "loc", "range", "raw"]);
  function walkReplace(node, replacer, parent, key) {
    for (const k in node) {
      if (SKIP_KEYS.has(k)) continue;
      const val = node[k];
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          const c = val[i];
          if (c && typeof c.type === "string") {
            walkReplace(c, replacer, node, k);
            const r = replacer(c, node, k);
            if (r && r !== c) val[i] = r;
          }
        }
      } else if (val && typeof val.type === "string") {
        walkReplace(val, replacer, node, k);
        const r = replacer(val, node, k);
        if (r && r !== val) node[k] = r;
      }
    }
  }

  function lit(value) {
    return { type: "Literal", value: value, raw: JSON.stringify(value) };
  }
  function num(n) {
    // Represent negatives as a unary minus so generation is unambiguous.
    if (n < 0) {
      return { type: "UnaryExpression", operator: "-", prefix: true,
               argument: { type: "Literal", value: -n, raw: String(-n) } };
    }
    return { type: "Literal", value: n, raw: String(n) };
  }
  function ident(name) { return { type: "Identifier", name: name }; }

  // ----------------------------------------------------------------------- //
  // Builtins / globals we never rename.
  // ----------------------------------------------------------------------- //
  const JS_BUILTINS = new Set([
    "console", "Math", "JSON", "Object", "Array", "String", "Number",
    "Boolean", "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet",
    "Promise", "Symbol", "BigInt", "Error", "TypeError", "RangeError",
    "parseInt", "parseFloat", "isNaN", "isFinite", "undefined", "NaN",
    "Infinity", "globalThis", "window", "document", "require", "module",
    "exports", "process", "setTimeout", "setInterval", "clearTimeout",
    "clearInterval", "arguments", "this", "eval", "encodeURIComponent",
    "decodeURIComponent", "escape", "unescape", "atob", "btoa", "structuredClone",
  ]);

  const ADV_VARS = ["total_price", "isValid", "userCount", "tempBuffer",
    "cacheHit", "retryLimit", "errorFlag", "configPath", "sessionId",
    "byteOffset", "rowIndex", "isReady", "maxDepth", "outputLines", "checksum"];
  const ADV_FUNCS = ["normalize", "validate", "flush", "encrypt", "shuffle",
    "reconnect", "sanitize", "rollback", "authenticate", "compress",
    "dispatch", "render", "prefetch", "serialize", "migrate"];
  const LOOKALIKE = ["l", "I", "O", "ll", "II", "OO", "lI", "Il", "O0", "l1"];

  // ----------------------------------------------------------------------- //
  // Pattern helpers: extract Identifier names bound by a binding pattern.
  // ----------------------------------------------------------------------- //
  function collectPatternNames(node, out) {
    if (!node) return;
    switch (node.type) {
      case "Identifier": out.add(node.name); break;
      case "ObjectPattern":
        node.properties.forEach((p) => {
          if (p.type === "RestElement") collectPatternNames(p.argument, out);
          else collectPatternNames(p.value, out);
        });
        break;
      case "ArrayPattern":
        node.elements.forEach((e) => collectPatternNames(e, out));
        break;
      case "AssignmentPattern": collectPatternNames(node.left, out); break;
      case "RestElement": collectPatternNames(node.argument, out); break;
      default: break;
    }
  }

  // ----------------------------------------------------------------------- //
  // 1. rename_identifiers
  //
  // Renames identifiers that are declared in the snippet (variables, function
  // and class names, parameters, catch bindings). Property names and object
  // keys are left alone. This uses one consistent name map across the whole
  // snippet, which is safe as long as a snippet does not use the same name as
  // both a local binding in one place and an undeclared global in another.
  // ----------------------------------------------------------------------- //
  function collectDeclared(ast) {
    const names = new Set();
    walk.simple(ast, {
      VariableDeclarator(n) { collectPatternNames(n.id, names); },
      FunctionDeclaration(n) {
        if (n.id) names.add(n.id.name);
        n.params.forEach((p) => collectPatternNames(p, names));
      },
      FunctionExpression(n) {
        if (n.id) names.add(n.id.name);
        n.params.forEach((p) => collectPatternNames(p, names));
      },
      ArrowFunctionExpression(n) {
        n.params.forEach((p) => collectPatternNames(p, names));
      },
      ClassDeclaration(n) { if (n.id) names.add(n.id.name); },
      ClassExpression(n) { if (n.id) names.add(n.id.name); },
      CatchClause(n) { if (n.param) collectPatternNames(n.param, names); },
    });
    return names;
  }

  function renameIdentifiers(ast, rng, opts) {
    opts = opts || {};
    const mode = opts.mode || "uninformative";
    const style = opts.style || "sequential";

    const declared = [...collectDeclared(ast)].filter((n) => !JS_BUILTINS.has(n));
    declared.sort();
    if (declared.length === 0) return ast;

    // Which declared names are function/class names (for adversarial pools).
    const funcNames = new Set();
    walk.simple(ast, {
      FunctionDeclaration(n) { if (n.id) funcNames.add(n.id.name); },
      ClassDeclaration(n) { if (n.id) funcNames.add(n.id.name); },
    });

    const map = new Map();
    if (mode === "adversarial") {
      const vp = shuffle(rng, ADV_VARS.slice());
      const fp = shuffle(rng, ADV_FUNCS.slice());
      let vi = 0, fi = 0;
      declared.forEach((name) => {
        if (funcNames.has(name)) {
          map.set(name, fp[fi % fp.length] + (fi < fp.length ? "" : String(fi)));
          fi++;
        } else {
          map.set(name, vp[vi % vp.length] + (vi < vp.length ? "" : String(vi)));
          vi++;
        }
      });
    } else if (style === "lookalike") {
      const pool = shuffle(rng, LOOKALIKE.slice());
      declared.forEach((name, i) => {
        map.set(name, i < pool.length ? pool[i] : pool[i % pool.length] + i);
      });
    } else {
      const letters = "abcdefghijklmnopqrstuvwxyz";
      const order = shuffle(rng, declared.map((_, i) => i));
      declared.forEach((name, i) => {
        const slot = order[i];
        map.set(name, letters[slot % 26] + String(slot + 1));
      });
    }

    // Ensure injective.
    const seen = new Set();
    for (const k of map.keys()) {
      let v = map.get(k);
      while (seen.has(v)) v = v + "_";
      seen.add(v);
      map.set(k, v);
    }

    // Apply with a full traversal that visits binding positions too. (The
    // acorn-walk Identifier visitor only fires on reference identifiers, so it
    // would miss function names and parameters.)
    function renameVisit(node, parent, key) {
      if (node.type === "Identifier" && map.has(node.name)) {
        if (renameable(node, parent, key)) node.name = map.get(node.name);
      }
      for (const k in node) {
        if (SKIP_KEYS.has(k)) continue;
        const val = node[k];
        if (Array.isArray(val)) {
          for (const c of val) if (c && typeof c.type === "string") renameVisit(c, node, k);
        } else if (val && typeof val.type === "string") {
          renameVisit(val, node, k);
        }
      }
    }
    function renameable(node, parent, key) {
      if (!parent) return true;
      // obj.name (non-computed member property)
      if (parent.type === "MemberExpression" && parent.property === node
          && !parent.computed) return false;
      // object / class member keys (non-computed)
      if ((parent.type === "Property" || parent.type === "MethodDefinition"
           || parent.type === "PropertyDefinition")
          && parent.key === node && !parent.computed) {
        if (parent.type === "Property" && parent.shorthand) {
          // {x} where x is renamed: expand to {x: newName}.
          parent.shorthand = false;
          parent.value = ident(map.get(node.name));
        }
        return false;
      }
      // labels are a separate namespace
      if (parent.type === "LabeledStatement" && parent.label === node) return false;
      if ((parent.type === "BreakStatement" || parent.type === "ContinueStatement")
          && parent.label === node) return false;
      return true;
    }
    renameVisit(ast, null, null);
    return ast;
  }

  // ----------------------------------------------------------------------- //
  // 2. control_flow_flatten
  //
  // Rewrites a function body's top-level statements into a while/if state
  // machine. Simple let/const/var declarations are hoisted (const becomes let)
  // and function declarations are hoisted, to keep JavaScript scoping valid.
  // Functions whose top level uses try, destructuring declarations, or class
  // declarations are skipped (a documented subset).
  // ----------------------------------------------------------------------- //
  function flattenBody(body, rng) {
    for (const s of body) {
      if (s.type === "TryStatement" || s.type === "ClassDeclaration") return null;
      if (s.type === "VariableDeclaration") {
        for (const d of s.declarations) {
          if (d.id.type !== "Identifier") return null; // destructuring: bail
        }
      }
    }

    const hoist = [];       // declarations placed before the loop
    const hoistNames = [];  // names to declare with a single `let`
    const stateBlocks = []; // arrays of statements, one per dispatch state

    for (const stmt of body) {
      if (stmt.type === "FunctionDeclaration") {
        hoist.push(stmt);
        continue;
      }
      if (stmt.type === "VariableDeclaration") {
        const assigns = [];
        for (const d of stmt.declarations) {
          hoistNames.push(d.id.name);
          if (d.init) {
            assigns.push({
              type: "ExpressionStatement",
              expression: { type: "AssignmentExpression", operator: "=",
                            left: ident(d.id.name), right: d.init },
            });
          }
        }
        if (assigns.length) stateBlocks.push(assigns);
        continue;
      }
      stateBlocks.push([stmt]);
    }

    if (stateBlocks.length < 2) return null;

    const stateVar = "_state_" + randint(rng, 0x1000, 0xffff).toString(16);

    // Build if/else if ... else break, from the last block upward.
    let elseBranch = { type: "BreakStatement", label: null };
    let dispatch = null;
    for (let i = stateBlocks.length - 1; i >= 0; i--) {
      const advance = {
        type: "ExpressionStatement",
        expression: { type: "AssignmentExpression", operator: "=",
                      left: ident(stateVar), right: num(i + 1) },
      };
      const consequent = { type: "BlockStatement",
                           body: stateBlocks[i].concat([advance]) };
      dispatch = {
        type: "IfStatement",
        test: { type: "BinaryExpression", operator: "===",
                left: ident(stateVar), right: num(i) },
        consequent: consequent,
        alternate: i === stateBlocks.length - 1
          ? { type: "BlockStatement", body: [elseBranch] }
          : elseBranch,
      };
      elseBranch = dispatch;
    }

    const loop = {
      type: "WhileStatement",
      test: lit(true),
      body: { type: "BlockStatement", body: [dispatch] },
    };
    const decls = [];
    if (hoistNames.length) {
      decls.push({
        type: "VariableDeclaration", kind: "let",
        declarations: hoistNames.map((n) => ({
          type: "VariableDeclarator", id: ident(n), init: null })),
      });
    }
    const stateInit = {
      type: "VariableDeclaration", kind: "let",
      declarations: [{ type: "VariableDeclarator", id: ident(stateVar),
                       init: num(0) }],
    };
    return hoist.concat(decls, [stateInit, loop]);
  }

  function controlFlowFlatten(ast, rng, opts) {
    const fns = [];
    walk.simple(ast, {
      FunctionDeclaration(n) { fns.push(n); },
      FunctionExpression(n) { fns.push(n); },
      ArrowFunctionExpression(n) { if (n.body.type === "BlockStatement") fns.push(n); },
    });
    for (const fn of fns) {
      if (!fn.body || fn.body.type !== "BlockStatement") continue;
      const rewritten = flattenBody(fn.body.body, rng);
      if (rewritten) fn.body.body = rewritten;
    }
    return ast;
  }

  // ----------------------------------------------------------------------- //
  // 3. dead_code_insertion
  // ----------------------------------------------------------------------- //
  function freshName(rng, prefix) {
    return prefix + randint(rng, 0x1000, 0xffff).toString(16);
  }
  function junkStatement(rng) {
    const name = freshName(rng, "_dead_");
    const n = randint(rng, -999, 999);
    return acorn.parse("var " + name + " = " + n + ";", PARSE_OPTS).body[0];
  }
  function opaqueGuard(rng) {
    const name = freshName(rng, "_dead_");
    const k = randint(rng, 2, 40);
    const src = "if ((" + k + " * " + k + ") < 0) { var " + name + " = "
      + randint(rng, 0, 99) + "; }";
    return acorn.parse(src, PARSE_OPTS).body[0];
  }
  function insertDead(block, rng, density) {
    for (let pos = block.length; pos >= 0; pos--) {
      if (rng() > density) continue;
      const node = rng() < 0.5 ? opaqueGuard(rng) : junkStatement(rng);
      block.splice(pos, 0, node);
    }
  }
  function deadCodeInsertion(ast, rng, opts) {
    opts = opts || {};
    const density = opts.density != null ? opts.density : 0.5;
    const blocks = [ast.body];
    walk.simple(ast, {
      BlockStatement(n) { blocks.push(n.body); },
    });
    for (const b of blocks) insertDead(b, rng, density);
    return ast;
  }

  // ----------------------------------------------------------------------- //
  // 4. string_encoding
  //
  // Replaces string literals with calls to an injected decode helper. base64
  // uses the environment's atob (present in modern browsers and Node 22). XOR
  // uses a small injected function. Directives ("use strict"), object keys and
  // import/export sources are left as literals.
  // ----------------------------------------------------------------------- //
  function b64encode(str) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(str, "utf-8").toString("base64");
    }
    return btoa(unescape(encodeURIComponent(str)));
  }
  function stringEncoding(ast, rng, opts) {
    opts = opts || {};
    const method = opts.method || "base64";
    const helper = freshName(rng, "_dec_");
    const xorKey = randint(rng, 1, 255);
    let count = 0;

    function skip(node, parent, key) {
      if (!parent) return true;
      if (parent.type === "ExpressionStatement" && parent.directive != null
          && key === "expression") return true;
      if (parent.type === "Property" && parent.key === node && !parent.computed)
        return true;
      if ((parent.type === "MethodDefinition" || parent.type === "PropertyDefinition")
          && parent.key === node && !parent.computed) return true;
      if ((parent.type === "ImportDeclaration"
           || parent.type === "ExportNamedDeclaration"
           || parent.type === "ExportAllDeclaration") && key === "source")
        return true;
      return false;
    }

    walkReplace(ast, function (node, parent, key) {
      if (node.type !== "Literal" || typeof node.value !== "string") return node;
      if (skip(node, parent, key)) return node;
      count++;
      if (method === "xor") {
        const bytes = [];
        const utf8 = unescape(encodeURIComponent(node.value));
        for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i) ^ xorKey);
        return {
          type: "CallExpression", optional: false, callee: ident(helper),
          arguments: [{ type: "ArrayExpression", elements: bytes.map(num) }, num(xorKey)],
        };
      }
      return {
        type: "CallExpression", optional: false, callee: ident(helper),
        arguments: [lit(b64encode(node.value))],
      };
    });

    if (count === 0) return ast;

    let helperSrc;
    if (method === "xor") {
      helperSrc = "function " + helper + "(data, k) {\n"
        + "  var out = '';\n"
        + "  for (var i = 0; i < data.length; i++) out += String.fromCharCode(data[i] ^ k);\n"
        + "  return decodeURIComponent(escape(out));\n}";
    } else {
      helperSrc = "function " + helper + "(s) {\n"
        + "  return decodeURIComponent(escape(atob(s)));\n}";
    }
    const helperNode = acorn.parse(helperSrc, PARSE_OPTS).body[0];
    // Insert after any leading directive prologue.
    let at = 0;
    while (at < ast.body.length && ast.body[at].type === "ExpressionStatement"
           && ast.body[at].directive != null) at++;
    ast.body.splice(at, 0, helperNode);
    return ast;
  }

  // ----------------------------------------------------------------------- //
  // 5. expression_rewriting
  //
  // Obfuscates small integer literals, rewrites `n * 2` into `n << 1` when n is
  // an integer literal (provably a number), and wraps boolean test positions in
  // double negation. The Python "x + 1 -> x - (-1)" rewrite is intentionally
  // omitted for JavaScript, where "+" also concatenates strings and the rewrite
  // would not be safe in general.
  // ----------------------------------------------------------------------- //
  function obfuscateInt(value, rng) {
    const strat = randint(rng, 0, 2);
    if (strat === 0) {
      const a = randint(rng, -40, 40);
      return { type: "BinaryExpression", operator: "+", left: num(a),
               right: num(value - a) };
    }
    if (strat === 1) {
      const b = randint(rng, -40, 40);
      return { type: "BinaryExpression", operator: "-", left: num(value + b),
               right: num(b) };
    }
    if (value >= 0) {
      const a = randint(rng, 0, Math.max(1, value + 32));
      return { type: "BinaryExpression", operator: "^", left: num(a),
               right: num(value ^ a) };
    }
    const a = randint(rng, -40, 40);
    return { type: "BinaryExpression", operator: "+", left: num(a),
             right: num(value - a) };
  }

  function expressionRewriting(ast, rng, opts) {
    opts = opts || {};
    const doConst = opts.constants !== false;
    const doMul = opts.mul !== false;
    const doBool = opts.bool !== false;

    walkReplace(ast, function (node, parent, key) {
      // n * 2 -> n << 1 when a numeric integer literal is involved.
      if (doMul && node.type === "BinaryExpression" && node.operator === "*") {
        const pairs = [[node.left, node.right], [node.right, node.left]];
        for (const [a, b] of pairs) {
          if (a.type === "Literal" && typeof a.value === "number"
              && Number.isInteger(a.value)
              && b.type === "Literal" && b.value === 2) {
            return { type: "BinaryExpression", operator: "<<", left: a, right: num(1) };
          }
        }
      }
      // Integer literal obfuscation.
      if (doConst && node.type === "Literal" && typeof node.value === "number"
          && Number.isInteger(node.value) && Math.abs(node.value) <= 1024) {
        // Skip non-computed numeric object keys.
        if (parent && parent.type === "Property" && parent.key === node
            && !parent.computed) return node;
        return obfuscateInt(node.value, rng);
      }
      return node;
    });

    if (doBool) {
      walk.simple(ast, {
        IfStatement(n) { n.test = notNot(n.test); },
        WhileStatement(n) {
          if (!(n.test.type === "Literal" && n.test.value === true)) n.test = notNot(n.test);
        },
        DoWhileStatement(n) { n.test = notNot(n.test); },
        ConditionalExpression(n) { n.test = notNot(n.test); },
      });
    }
    return ast;
  }
  function notNot(expr) {
    return {
      type: "UnaryExpression", operator: "!", prefix: true,
      argument: { type: "UnaryExpression", operator: "!", prefix: true, argument: expr },
    };
  }

  // ----------------------------------------------------------------------- //
  // Registry + ladder
  // ----------------------------------------------------------------------- //
  const REGISTRY = {
    rename_identifiers: { func: renameIdentifiers },
    control_flow_flatten: { func: controlFlowFlatten },
    dead_code_insertion: { func: deadCodeInsertion },
    string_encoding: { func: stringEncoding },
    expression_rewriting: { func: expressionRewriting },
  };

  function generate(ast) {
    return astring.generate(ast, { indent: "    ", lineEnd: "\n" });
  }

  function ladderJS(source, transforms, seed) {
    seed = seed || 0;
    let ast = acorn.parse(source, PARSE_OPTS);
    const rungs = [{ name: "original", code: generate(ast) }];
    transforms.forEach((spec, i) => {
      const name = spec.name;
      const options = spec.options || {};
      const rng = makeRng(seed + ":" + i + ":" + name);
      REGISTRY[name].func(ast, rng, options);
      const code = generate(ast);
      // Re-parse so later transforms see a clean tree with no stale references.
      ast = acorn.parse(code, PARSE_OPTS);
      let label = name;
      const keys = Object.keys(options);
      if (keys.length) {
        label = name + " (" + keys.map((k) => k + "=" + options[k]).join(", ") + ")";
      }
      rungs.push({ name: label, code: code });
    });
    return rungs;
  }

  return {
    ladderJS: ladderJS,
    REGISTRY: REGISTRY,
    renameIdentifiers: renameIdentifiers,
    controlFlowFlatten: controlFlowFlatten,
    deadCodeInsertion: deadCodeInsertion,
    stringEncoding: stringEncoding,
    expressionRewriting: expressionRewriting,
    _parse: (s) => acorn.parse(s, PARSE_OPTS),
    _generate: generate,
  };
});
