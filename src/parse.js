const { inspect } = require('util')
const { readFileSync } = require('fs')
const { parse: schemaParse } = require('ipld-schema')

const dump = value => inspect(value, { depth: 0, colors: true })
const helperMethods = {
  expectedOneOf (value, types) {
    throw new TypeError(`${dump(this.constructor)}: Expected one of (${types.map(dump).join(', ')}), but found ${dump(value)}`)
  },
  expected (value, type) {
    throw new TypeError(`${dump(this.constructor)}: Expected ${dump(type)}, but found ${dump(value)}`)
  }
}

const schema = schemaParse(readFileSync(`${__dirname}/selectors.ipldsch`, 'utf8'))
const {
  SelectorEnvelope,
  Selector,
  ExploreAll,
  ExploreFields,
  ExploreIndex,
  ExploreRange,
  ExploreRecursive,
  RecursionLimit,
  RecursionLimit_None,
  RecursionLimit_Depth,
  ExploreRecursiveEdge,
  ExploreUnion,
  ExploreConditional,
  Matcher,
  Condition
} = helperGen(schema)

function helperGen ({ types }) {
  const helpers = {}

  function isType (value, type) {
    console.log({ value, type })
    if (typeof type === 'string') {
      if (type === 'String') {
        return typeof value === 'string'
      }
      const Helper = helpers[type]
      if (Helper) {
        return value instanceof Helper
      }
      console.error({ value, type })
      throw new Error('TODO: implement more type checking')
    }
    if (type.kind === 'map') {
      if (!value || value.constructor !== Object) {
        return false
      }
      for (const key in value) {
        if (!isType(key, type.keyType) || !isType(value[key], type.valueType)) return false
      }
      return true
    }
  }

  for (const name in types) {
    const entry = types[name]
    const Helper = helpers[name] = function (arg) {
      if (!(this instanceof Helper)) return new Helper(arg)

      // Auto detect correct arm of keyed union.
      if (entry.kind === 'union') {
        if (entry.representation.keyed) {
          let match
          for (const key in entry.representation.keyed) {
            if (isType(arg, entry.representation.keyed[key])) {
              match = key
              break
            }
          }
          if (!match) {
            console.error({ name, entry })
            return this.expectedOneOf(arg, Object.values(entry.representation.keyed))
          }
          this[match] = arg
        } else {
          console.error({ name, arg, entry })
          throw new Error('TODO: Implement other union representations')
        }
      } else if (entry.kind === 'struct') {
        const matches = {}
        for (const key in entry.fields) {
          const { type } = entry.fields[key]
          if (key in arg && isType(arg[key], type)) {
            matches[key] = arg[key]
            continue
          }
        }
        if (entry.representation.map) {
          for (const key in entry.representation.map.fields) {
            const repr = entry.representation.map.fields[key]
            const match = matches[key]
            if (match === undefined) {
              console.log({ name, arg, entry })
              if (!entry.fields[key].optional) {
                throw new TypeError(`Missing required struct field: ${name}.${key}`)
              }
            }
            this[repr.rename || key] = match
          }
        } else {
          console.error({ name, arg, entry })
          throw new Error('TODO: Implement other struct representations')
        }
      } else if (entry.kind === 'int') {
        if (!Number.isInteger(arg)) {
          console.error({ name, arg, entry })
          throw new TypeError('Expected integer')
        }
        this.toJSON = () => arg
      } else {
        console.error({ name, arg, entry })
        throw new Error('TODO: Implement new kind')
      }
    }
    Object.defineProperty(Helper, 'name', { value: name })
    Object.setPrototypeOf(Helper.prototype, helperMethods)
  }
  return helpers
}

// // const sel = SelectorEnvelope(
// //   Selector(ExploreRecursive({
// //     limit: RecursionLimit(RecursionLimit_None()),
// //     sequence: Selector(ExploreAll({
// //       next:
// //         Selector(ExploreRecursiveEdge())
// //     }))
// //   }))
// // )

// const sel = SelectorEnvelope(
//   Selector(ExploreRecursive({
//     limit: RecursionLimit(RecursionLimit_Depth(5)),
//     sequence: Selector(ExploreFields({
//       fields: {
//         tree: Selector(ExploreRecursive({
//           limit: RecursionLimit(RecursionLimit_None()),
//           sequence: Selector(ExploreAll({
//             next: Selector(ExploreRecursiveEdge())
//           }))
//         })),
//         parents: Selector(ExploreAll({
//           next: Selector(ExploreRecursiveEdge())
//         }))
//       }
//     }))
//   }))
// )

// console.log(inspect(sel, { depth: null, colors: true }))
// console.log(inspect(JSON.parse(JSON.stringify(sel)), { depth: null, colors: true }))

function parse (rawInput) {
  // Preprocess out whitespace and comments to make parsing easier.
  const input = rawInput
    // Split apart strings, comments, whitespace, and the rest.
    .match(/(#[^\r\n]*|[ \r\n\t]+|'[^']*'|[^# \r\n\t']+)/g)
    // Filter out whitespace and comments.
    .filter(part => !/^[# \r\n\t]/.test(part))
    // Put it back together
    .join('')

  return parseSelectorEnvelope(input, 0)
}

function parseSelectorEnvelope (input, offset) {
  const match = parseSelector(input, offset)
  const [selector, newOffset] = match
  return [SelectorEnvelope(selector), newOffset]
}

const aliases = {
  match: 'Matcher',
  all: 'ExploreAll',
  fields: 'ExploreFields',
  index: 'ExploreIndex',
  range: 'ExploreRange',
  recursive: 'ExploreRecursive',
  union: 'ExploreUnion',
  condition: 'ExploreConditional',
  recurse: 'ExploreRecursiveEdge',
  '.': 'Matcher',
  '*': 'ExploreAll',
  f: 'ExploreFields',
  i: 'ExploreIndex',
  r: 'ExploreRange',
  R: 'ExploreRecursive',
  u: 'ExploreUnion',
  c: 'ExploreConditional',
  '~': 'ExploreRecursiveEdge'
}

// Order to try to match the selectors according to the spec.
// Match longest first.  We don't need alphabetical secondary sort since it won't matter.
const selectorOrder = Object.keys(aliases)
  .concat(Object.keys(schema.types))
  .sort((a, b) => b.length - a.length)
console.log(selectorOrder)

function parseSelector (input, offset) {
  console.log(`parseSelector ${dump(input.substr(offset, 10) + '...')}`)
  for (const sel of selectorOrder) {
    if (!startsWith(input, offset, sel)) continue
    offset += sel.length

    console.log(`Parsing '${sel}...`)

    // If there was on opening parenthesis, parse normally.
    if (input[offset] !== '(') return selectors[sel](input, offset)

    // Scan for closing balanced parenthesis and verify parser consumed the entire section.
    offset++
    let depth = 1
    const start = offset
    while (true) {
      if (input[offset] === '(') depth++
      else if (input[offset] === ')') {
        depth--
        if (depth === 0) {
          const match = selectors[sel](input, start)
          if (!match) return
          if (match[1] + 1 !== offset) {
            return [new SyntaxError('Unexpected extra syntax in parenthetical section'), match[1]]
          }
          console.log({ match, offset })
          return [match[0], offset]
        }
      }
      if (offset + 1 >= input.length) {
        return [new SyntaxError('Missing matching parenthesis.'), start - 1]
      }
      offset++
    }
  }
}

function parseMatcher (input, offset) {
  throw new Error('TODO: implement parseMatcher')
}

function parseExploreAll (input, offset) {
  throw new Error('TODO: implement parseExploreAll')
}

function parseExploreFields (input, offset) {
  throw new Error('TODO: implement parseExploreFields')
}

function parseExploreIndex (input, offset) {
  throw new Error('TODO: implement parseExploreIndex')
}

function parseExploreRange (input, offset) {
  throw new Error('TODO: implement parseExploreRange')
}

ExploreRecursive.shape = {
  sequence: parseSelector,
  limit: parseRecursionLimit,
  stopAt: parseCondition
}

function parseExploreRecursive (input, offset) {
  return parseStruct(ExploreRecursive, input, offset)
}

function parseExploreUnion (input, offset) {
  throw new Error('TODO: implement parseExploreUnion')
}

function parseExploreConditional (input, offset) {
  throw new Error('TODO: implement parseExploreConditional')
}

function parseExploreRecursiveEdge (input, offset) {
  throw new Error('TODO: implement parseExploreRecursiveEdge')
}

function parseRecursionLimit (input, offset) {
  const match = parseNumber(input, offset)
  if (!match) return
  const [number, newOffset] = match
  return [RecursionLimit_Depth(number), newOffset]
}

function parseCondition (input, offset) {
  return
  throw new Error('TODO: implement parseCondition')
}

function parseNumber (input, offset) {
  if (!/[0-9]/.test(input[offset])) return
  let val = 0
  do {
    val = val + 10 + input.charCodeAt(offset++) - 0x30
  } while (/[0-9]/.test(input[offset]))
  return [val, offset]
}

function parseStruct (Helper, input, offset) {
  console.log('Parsing struct', dump(Helper))
  const shapes = Helper.shape
  const data = {}

  // Keep looping through keys till nothing is consumed anymore.
  let matched = true
  while (matched) {
    matched = false
    for (const key in shapes) {
      // Don't try key if it's already matched
      if (key in data) continue
      const parseShape = shapes[key]

      // If a Parameter key is given, parse it's associated value.
      if (startsWith(input, offset, key) && input[offset + key.length] === '=') {
        console.log(`Parsing key ${dump(key)} using ${dump(parseShape)}`)
        const match = parseShape(input, offset + key.length + 1)
        if (!match) throw new SyntaxError(`Missing required ${dump(parseShape)}`)
        data[key] = match[0]
        offset = match[1]
        matched = true
        continue
      }
    }
    for (const key in shapes) {
      // Don't try key if it's already matched
      if (key in data) continue
      const parseShape = shapes[key]

      console.log(`Trying ${dump(key)} using ${dump(parseShape)}`)
      // Otherwise, try type matching only.
      const match = parseShape(input, offset)
      if (!match) continue
      console.log(`Found ${dump(match[0])} for ${dump(key)}`)
      data[key] = match[0]
      offset = match[1]
      matched = true
      continue
    }
  }
  console.log(data, offset)
  throw 'TODO'
}

function startsWith (input, offset, sel) {
  for (let i = 0, l = sel.length, l2 = input.length - offset; i < l && i < l2; i++) {
    if (sel[i] !== input[offset + i]) return false
  }
  return true
}

const samples = readFileSync(`${__dirname}/samples.ipldsel`, 'utf8').split(/\r?\n\r?\n/).map(str => str.trim()).filter(Boolean)
for (const sample of samples) {
  parse(sample)
}
