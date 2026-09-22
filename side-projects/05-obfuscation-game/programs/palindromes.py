# Keep the words that read the same backwards.
words = ["level", "python", "noon", "radar", "code", "civic"]
found = [w for w in words if w == w[::-1]]
print(len(found), ",".join(found))
