# Sum of the squares of the odd numbers below 12.
total = 0
for n in range(12):
    if n % 2 == 1:
        total += n * n
print("sum", total)
