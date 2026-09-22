// Caesar cipher: encode a message then decode it back.
function shiftChar(ch, k) {
  if (ch >= "a" && ch <= "z") {
    const base = "a".charCodeAt(0);
    return String.fromCharCode(((ch.charCodeAt(0) - base + k) % 26) + base);
  }
  return ch;
}

function encode(message, k) {
  let out = "";
  for (const c of message) out += shiftChar(c, k);
  return out;
}

const plain = "the quick brown fox";
const secret = encode(plain, 3);
const back = encode(secret, 23);
console.log("plain ", plain);
console.log("secret", secret);
console.log("back  ", back);
console.log("ok", back === plain);
