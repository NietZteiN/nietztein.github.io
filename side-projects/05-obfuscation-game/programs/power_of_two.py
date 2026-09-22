# Find the smallest power of two above 1000 using shifts.
value = 1
exponent = 0
while value <= 1000:
    value = value << 1
    exponent += 1
print("2^" + str(exponent), "=", value)
