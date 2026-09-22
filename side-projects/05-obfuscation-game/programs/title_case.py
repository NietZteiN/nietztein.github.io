# Capitalize every second word and join with dashes.
text = "small steps every single day"
parts = text.split()
result = []
for i, part in enumerate(parts):
    if i % 2 == 1:
        result.append(part.upper())
    else:
        result.append(part)
print("-".join(result))
