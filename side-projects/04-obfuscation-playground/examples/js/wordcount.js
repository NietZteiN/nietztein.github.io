// Count word frequencies in a fixed passage and show the top five.
const text = "the quick brown fox jumps over the lazy dog "
  + "the dog was not amused and the fox ran away "
  + "over the hill and far away the fox went";

function countWords(passage) {
  const counts = {};
  for (const word of passage.split(" ")) {
    counts[word] = (counts[word] || 0) + 1;
  }
  return counts;
}

const freq = countWords(text);
const ranked = Object.keys(freq).sort((a, b) => freq[b] - freq[a] || (a < b ? -1 : 1));
for (const word of ranked.slice(0, 5)) {
  console.log(word, freq[word]);
}
