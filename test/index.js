const { parse, encode } = require('..');
const { inspect } = require('util')

const dump = value => inspect(value, { depth: 100, colors: true })

const samples = require('fs')
  .readFileSync(__dirname + "/samples.ipldsel", "utf8")
  .split(/\r?\n\r?\n/).map(str => str.trim()).filter(Boolean)

for (const sample of samples) {
  console.log("\nSample:\n")
  console.log("    " + sample.split("\n").join('\n    ') + "\n");
  try {
    const value = parse(sample)
    if (!value) {
      console.log(`No Selector.\n`)
    } else {
      console.log(`Result: \n\n    ${dump(value).split('\n').join('\n    ')} \n`);
      const long = encode(value, 'long');
      console.log(`Long Form: \n\n    ${long.split('\n').join('\n    ')} \n`);
      const short = encode(value, 'short');
      console.log(`Short Form: \n\n    ${short.split('\n').join('\n    ')} \n`);
    }
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
  }
}
