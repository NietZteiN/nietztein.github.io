# Bubble sort a fixed list and report the number of swaps.
def bubble_sort(items):
    data = list(items)
    swaps = 0
    for i in range(len(data)):
        for j in range(len(data) - 1 - i):
            if data[j] > data[j + 1]:
                data[j], data[j + 1] = data[j + 1], data[j]
                swaps = swaps + 1
    return data, swaps


numbers = [5, 2, 9, 1, 5, 6, 3, 8, 4, 7]
ordered, count = bubble_sort(numbers)
print("sorted", ordered)
print("swaps", count)
