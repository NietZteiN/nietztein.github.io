# Count word frequencies in a fixed passage and show the top five.
text = """the quick brown fox jumps over the lazy dog
the dog was not amused and the fox ran away
over the hill and far away the fox went"""


def count_words(passage):
    counts = {}
    for word in passage.split():
        counts[word] = counts.get(word, 0) + 1
    return counts


freq = count_words(text)
ranked = sorted(freq.items(), key=lambda pair: (-pair[1], pair[0]))
for word, n in ranked[:5]:
    print(word, n)
