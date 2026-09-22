# Evaluate a boolean expression over all inputs and count the true rows.
true_rows = 0
for a in (False, True):
    for b in (False, True):
        for c in (False, True):
            if (a and not b) or (b and c):
                true_rows += 1
print("true rows", true_rows)
