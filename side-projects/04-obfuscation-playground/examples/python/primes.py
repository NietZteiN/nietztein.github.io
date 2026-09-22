# Sieve of Eratosthenes: print the primes below 50.
def primes_below(limit):
    sieve = [True] * limit
    sieve[0] = False
    if limit > 1:
        sieve[1] = False
    for i in range(2, limit):
        if sieve[i]:
            for j in range(i * i, limit, i):
                sieve[j] = False
    return [i for i in range(limit) if sieve[i]]


found = primes_below(50)
print("count", len(found))
print("primes", found)
