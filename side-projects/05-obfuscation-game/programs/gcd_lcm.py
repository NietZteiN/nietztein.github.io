# Euclid's algorithm for the gcd, then the lcm from it.
def gcd(a, b):
    while b != 0:
        a, b = b, a % b
    return a


x = 84
y = 36
g = gcd(x, y)
print("gcd", g, "lcm", x * y // g)
