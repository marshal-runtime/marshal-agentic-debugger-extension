// JavaScript test program for integration tests.
// Provides debuggable functions with local variables of various types.

function calculate(a, b) {
  const sum = a + b;
  const product = a * b;
  const result = { sum, product };
  return result;
}

function processData(items) {
  const count = items.length;
  const first = items[0];
  const doubled = items.map((x) => x * 2);
  const total = items.reduce((acc, x) => acc + x, 0);
  return { count, first, doubled, total };
}

function main() {
  const greeting = 'hello';
  const value = 42;
  const data = [1, 2, 3, 4, 5];

  const calcResult = calculate(10, 20);
  const processed = processData(data);

  console.log(greeting, value, calcResult, processed);
}

main();
