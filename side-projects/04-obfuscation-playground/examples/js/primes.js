// Sieve of Eratosthenes: primes below 50.
function primesBelow(limit) {
  const sieve = new Array(limit).fill(true);
  sieve[0] = false;
  if (limit > 1) sieve[1] = false;
  for (let i = 2; i < limit; i++) {
    if (sieve[i]) {
      for (let j = i * i; j < limit; j += i) sieve[j] = false;
    }
  }
  const out = [];
  for (let i = 0; i < limit; i++) if (sieve[i]) out.push(i);
  return out;
}

const found = primesBelow(50);
console.log("count", found.length);
console.log("primes", found.join(","));
