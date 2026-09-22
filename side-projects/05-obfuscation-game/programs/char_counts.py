# Count letters in a word and print the most frequent one with its count.
word = "mississippi"
counts = {}
for ch in word:
    counts[ch] = counts.get(ch, 0) + 1
best = None
for ch in counts:
    if best is None or counts[ch] > counts[best]:
        best = ch
print(best, counts[best])
