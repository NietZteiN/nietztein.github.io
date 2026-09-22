# Track the running maximum of a list and count how often it changes.
values = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
best = values[0]
changes = 0
for v in values[1:]:
    if v > best:
        best = v
        changes += 1
print("max", best, "changes", changes)
