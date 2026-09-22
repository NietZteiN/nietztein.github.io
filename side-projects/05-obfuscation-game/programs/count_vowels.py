# Count the vowels in a sentence with a simple loop.
sentence = "the rain in spain stays mainly in the plain"
count = 0
for ch in sentence:
    if ch in "aeiou":
        count = count + 1
print("vowels", count)
