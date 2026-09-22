# Reverse the order of words, then reverse each word.
phrase = "code is read more than written"
words = phrase.split()
words.reverse()
flipped = [w[::-1] for w in words]
print(" ".join(flipped))
