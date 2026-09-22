# Ackermann's function for small arguments (deep recursion, small answer).
def ack(m, n):
    if m == 0:
        return n + 1
    if n == 0:
        return ack(m - 1, 1)
    return ack(m - 1, ack(m, n - 1))


print("ack(2,3)", ack(2, 3), "ack(3,2)", ack(3, 2))
