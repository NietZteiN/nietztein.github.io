# Caesar cipher: encode a message, then decode it back.
def shift_char(ch, k):
    if "a" <= ch <= "z":
        base = ord("a")
        return chr((ord(ch) - base + k) % 26 + base)
    return ch


def encode(message, k):
    return "".join(shift_char(c, k) for c in message)


def decode(message, k):
    return encode(message, 26 - k)


plain = "the quick brown fox"
secret = encode(plain, 3)
back = decode(secret, 3)
print("plain ", plain)
print("secret", secret)
print("back  ", back)
print("ok", back == plain)
