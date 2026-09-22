// FizzBuzz for the numbers 1 through 20.
function classify(n) {
  if (n % 15 === 0) return "FizzBuzz";
  if (n % 3 === 0) return "Fizz";
  if (n % 5 === 0) return "Buzz";
  return String(n);
}

const results = [];
for (let n = 1; n <= 20; n++) {
  results.push(classify(n));
}
console.log(results.join(" "));
