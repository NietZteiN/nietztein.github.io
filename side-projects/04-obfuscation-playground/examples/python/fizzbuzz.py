# Classic FizzBuzz for the numbers 1 through 20.
def classify(n):
    if n % 15 == 0:
        return "FizzBuzz"
    if n % 3 == 0:
        return "Fizz"
    if n % 5 == 0:
        return "Buzz"
    return str(n)


def main():
    results = []
    for n in range(1, 21):
        results.append(classify(n))
    print(" ".join(results))


main()
