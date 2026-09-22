# Build a small multiplication table and sum its diagonal.
size = 4
table = [[(r + 1) * (c + 1) for c in range(size)] for r in range(size)]
diagonal = [table[i][i] for i in range(size)]
print(table[2], sum(diagonal))
