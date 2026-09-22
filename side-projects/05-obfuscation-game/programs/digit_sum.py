# Sum of digits of a number, then the sum of digits of that sum.
def digit_sum(n):
    total = 0
    while n > 0:
        total += n % 10
        n = n // 10
    return total


first = digit_sum(98765)
second = digit_sum(first)
print(first, second)
