# Slice a list three ways and print the pieces.
items = [10, 20, 30, 40, 50, 60, 70, 80]
head = items[:3]
tail = items[-2:]
step = items[1::3]
print(head, tail, step)
