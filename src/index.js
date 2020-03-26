const { schema, entry, aliases, ignores } = require('./selector-syntax')

exports.parse = require('./make-parser')(schema, entry, aliases, ignores);

exports.encode = require('./make-encoder')(schema, entry, aliases, ignores);