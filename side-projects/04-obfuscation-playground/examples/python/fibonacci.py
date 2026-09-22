# Compare an iterative and a recursive Fibonacci for the first 12 terms.
def fib_iter(n):
    a = 0
    b = 1
    for _ in range(n):
        a, b = b, a + b
    return a


def fib_rec(n):
    if n < 2:
        return n
    return fib_rec(n - 1) + fib_rec(n - 2)


values_iter = [fib_iter(k) for k in range(12)]
values_rec = [fib_rec(k) for k in range(12)]
print("iter", values_iter)
print("rec ", values_rec)
print("match", values_iter == values_rec)
