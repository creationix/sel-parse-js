
const longest = (a, b) => b.length - a.length

const escapes = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  "\\": "\\",
  "'": "'",
}

function parseString(input, offset) {
  const first = input[offset]
  if (first !== "'") return;
  const match = input.substr(offset).match(/^'((?:\\'|[^'])*)'/);
  if (!match) throw new SyntaxError(`Unterminated string at ${offset}`)
  const [all, inner] = match;
  return [inner.replace(/\\./g, (esc, i) => {
    const val = escapes[esc[1]];
    if (val) return val;
    console.log({ i })
    throw new SyntaxError(`Invalid escape at ${offset + i + 1}`)
  }), offset + all.length]
}

function parseInteger(input, offset) {
  let sign = 1;
  if (input[offset] === '-') {
    sign = -1;
    offset++;
  }
  let byte = input.charCodeAt(offset)
  if (byte < 0x30 || byte > 0x39) return
  let val = 0;
  while (byte >= 0x30 && byte <= 0x39) {
    val = val * 10 + (byte - 0x30)
    offset++
    byte = input.charCodeAt(offset)
  }
  return [val * sign, offset]
}

function parenCheck(input, offset, parse) {
  let paren = input[offset] === '(' ? 1 : 0
  const result = parse(input, offset + paren);
  if (!result) return;
  const [value, newOffset] = result;
  // console.log({ value, paren, newOffset })
  if (paren) {
    if (input[newOffset] !== ')') throw new SyntaxError(`Missing closing parenthesis at ${newOffset}`)
  }
  return [value, newOffset + paren]
}

function emptyCheck(input, offset, parse) {
  const result = parenCheck(input, offset, parse);
  if (!result || result[1] === offset) return;
  return result
}

module.exports = makeParser
function makeParser({ types }, entry, aliases = {}, ignores = []) {

  let parsers = new Map();

  for (const key of ignores) {
    // console.log("Ignoring type", key)
    parsers.set(key, (input, offset) => {
      // console.warn("Ignoring type", key)
    });
  }

  const parseEntry = gen(entry);

  return (rawInput) => {
    // Preprocess out whitespace and comments to make parsing easier.
    const input = rawInput
      // Split apart strings, comments, whitespace, and the rest.
      .match(/(#[^\r\n]*|[ \r\n\t]+|'(?:\\'|[^'])*'?|[^'# \r\n\t]+)/g)
      // Filter out whitespace and comments.
      .filter(part => !/^[# \r\n\t]/.test(part))
      // Put it back together
      .join('')
    // console.log({ input })

    let result
    try {
      result = parseEntry(input, 0)
      if (!result) return
      const [value, offset] = result
      if (offset < input.length) throw new SyntaxError(`Unexpected extra syntax at ${offset}`)
      return value;
    }
    catch (err) {
      if (err instanceof SyntaxError && /at [0-9]+$/.test(err.message)) {
        const offset = parseInt(err.message.match(/[0-9]+$/)[0])
        let rest = input.substr(offset)
        if (rest.length > 40) rest = rest.substr(0, 40) + "..."
        const indent = " ".repeat(offset + 14);
        console.error(`\n\x1b[1;31mSyntaxError: "${input}"\n${indent}^ ${err.message}\x1b[0m\n`)
      }
      throw err
    }
  }

  function gen(type) {
    const existing = parsers.get(type);
    if (existing) return existing;
    const parser = genReal(type);
    parsers.set(type, parser)
    Object.defineProperty(parser, 'name', { value: type })
    return parser;
  }

  function genReal(typeName) {
    const type = types[typeName] || typeName;
    if (type === typeName) typeName = undefined
    if (type) {
      if (type === 'String') return parseString;
      if (type === 'Int' || type.kind === 'int') return parseInteger;
      if (type.kind === 'map') return genMap(type);
      if (type.kind === 'list') return genList(type);
      if (type.kind === 'union' && type.representation && type.representation.keyed) return genKeyedUnion(typeName, type)
      if (type.kind === 'struct' && type.fields && type.representation && type.representation.map) return genMappedStruct(typeName, type)
    }
    return (input, offset) => {
      console.log({ typeName, type });
      throw new Error("TODO: Support new type")
    }
  }

  function genKeyedUnion(name, { representation: { keyed: keys } }) {
    // console.log('genKeyedUnion', name)

    const keywords = [];
    const reverse = {};
    for (const [key, type] of Object.entries(keys)) {
      const list = aliases[type];
      if (!list) continue;
      // console.log({ key, list })
      for (const alias of list) {
        keywords.push(alias);
        reverse[alias] = key;
      }
    }
    keywords.sort(longest)

    return (input, offset) => {
      // console.log("parsing keyed union", name)
      // console.log({ keywords, keys })

      // console.log({ keywords, reverse });
      for (const keyword of keywords) {
        if (startsWith(input, offset, keyword)) {
          const key = reverse[keyword];
          const type = keys[key]
          const result = parenCheck(input, offset + keyword.length, gen(type))
          if (!result) throw new SyntaxError(`Failed parsing ${type} at ${offset}`)
          const [value, newOffset] = result
          return [{ [key]: value }, newOffset]
        }
      }
      for (const [key, type] of Object.entries(keys)) {
        if (aliases[type]) continue;
        // console.log(name, key)
        const result = emptyCheck(input, offset, gen(type))
        if (!result) continue;
        const [value, newOffset] = result
        return [{ [key]: value }, newOffset]
      }
    }
  }

  function genMappedStruct(name, { fields, representation: { map } }) {
    // console.log('genMappedStruct', name)
    const fieldNames = Object.keys(fields).sort(longest)
    const names = fieldNames.map(name => `${name}=`)
    // console.log({ names, fieldNames })
    return (input, offset) => {
      // console.log("parsing mapped struct", name)
      const struct = {};
      // console.log(name, fields, map)
      let start
      outer: do {
        start = offset;
        // console.log({ offset, rest: input.substr(offset) })
        for (let i = 0, l = names.length; i < l; i++) {
          const fieldName = fieldNames[i];
          if (fieldName in struct) continue;
          const name = names[i];
          if (startsWith(input, offset, name)) {
            const { type } = fields[fieldName];
            const result = emptyCheck(input, offset + name.length, gen(type));
            if (!result) throw new SyntaxError(`Failed to parse named parameter at ${offset}`)
            const [value, newOffset] = result;
            // console.log("Named struct field", { fieldName, value })
            struct[fieldName] = value
            offset = newOffset
            continue outer;
          }
        }
        for (const [key, { type }] of Object.entries(fields)) {
          if (key in struct) continue;
          const result = emptyCheck(input, offset, gen(type))
          if (!result) continue;
          const [value, newOffset] = result;
          // console.log("Typed struct field", { key, value })
          struct[key] = value;
          offset = newOffset
          continue outer
        }
      } while (offset > start)

      const remapped = {}
      for (const key of Object.keys(fields)) {
        if (key in struct) {
          const renamedKey = map.fields && map.fields[key] && map.fields[key].rename || key
          remapped[renamedKey] = struct[key]
        } else {
          if (!fields[key].optional) {
            throw new SyntaxError(`Missing required struct field "${key}" at ${offset}`)
          }
        }
      }
      // console.log({ remapped })
      return [remapped, offset]
    }
  }

  function genMap({ keyType, valueType }) {
    // console.log('genMap', keyType, valueType)

    // console.log({ keyType, valueType })
    return (input, offset) => {
      const map = {};
      while (true) {
        const keyResult = emptyCheck(input, offset, gen(keyType));
        if (!keyResult) return [map, offset];
        const [key, newOffset] = keyResult;
        const valueResult = parenCheck(input, newOffset, gen(valueType));
        // console.log({ key, newOffset })
        if (!valueResult) throw new SyntaxError(`Failed to parse map value ${valueType} at ${offset}`)
        const [value, finalOffset] = valueResult;
        map[key] = value;
        offset = finalOffset
      }
      return map;
    }
  }

  function genList({ valueType }) {
    // console.log('genList', valueType)

    return (input, offset) => {
      const list = [];
      while (true) {
        const valueResult = emptyCheck(input, offset, gen(valueType));
        if (!valueResult) break;
        const [value, newOffset] = valueResult;
        list.push(value);
        offset = newOffset
      }
      return [list, offset];
    }
  }

}

function startsWith(input, offset, keyword) {
  if (input.length - offset < keyword.length) return false;
  for (let i = 0, l = keyword.length, l2 = input.length - offset; i < l && i < l2; i++) {
    if (keyword[i] !== input[offset + i]) return false
  }
  return true
}


