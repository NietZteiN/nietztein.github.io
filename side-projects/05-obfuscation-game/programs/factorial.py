# Recursive factorial of 7 and the number of trailing zeros in it.
def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)


value = fact(7)
zeros = 0
while value % 10 == 0:
    value = value // 10
    zeros += 1
print("fact7", fact(7), "zeros", zeros)
