# Binary search for 37 and report the number of probes.
data = [2, 5, 8, 12, 16, 23, 37, 44, 56, 72, 91]
target = 37
lo = 0
hi = len(data) - 1
probes = 0
while lo <= hi:
    mid = (lo + hi) // 2
    probes += 1
    if data[mid] == target:
        break
    if data[mid] < target:
        lo = mid + 1
    else:
        hi = mid - 1
print("index", mid, "probes", probes)
