
exports.schema = require('ipld-schema').parse(
    require('fs').readFileSync(__dirname + "/selector.ipldsch", "utf8")
)

exports.entry = "SelectorEnvelope"

exports.aliases = {
    Matcher: ['match', '.'],
    ExploreAll: ['all', '*'],
    ExploreFields: ['fields', 'f'],
    ExploreIndex: ['index', 'i'],
    ExploreRange: ['range', 'r'],
    ExploreRecursive: ['recursive', 'R'],
    ExploreUnion: ['union', 'u'],
    ExploreConditional: ['condition', 'c'],
    ExploreRecursiveEdge: ['recurse', '~'],
    RecursionLimit_None: ['none', 'n'],
}

exports.ignores = [
    "Condition",
    "Condition_HasField",
    "Condition_HasValue",
    "Condition_HasKind",
    "Condition_IsLink",
    "Condition_GreaterThan",
    "Condition_LessThan",
    "Condition_And",
    "Condition_Or",
]
