import type { RollOptionSet } from './rollOptions'

// PF2e's predicate language, evaluated three ways.
//
// The system's own evaluator is a boolean: an option is in the set or it is not.
// It can afford that, because it holds the complete set. This engine does not,
// so it needs a third answer — and getting that third answer right is the
// difference between an estimator that admits its gaps and one that quietly
// reports a wrong number.
//
//   'true'     the statement holds
//   'false'    the statement does not hold
//   'unknown'  the statement references something outside the closed option set
//
// Faithful to `StatementValidator` and `Predicate#test` in pf2e 8.4.1: atomic
// strings, five binary operators over `key:value` options, and the compound
// forms and / or / nand / nor / xor / not / if / iff.

export type Truth = 'true' | 'false' | 'unknown'

export type PredicateStatement = string | { [key: string]: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Kleene logic, which is what the compound operators need once a third value
// exists: an OR with one true arm is true even if another is unknown, because no
// resolution of the unknown could change the answer. An OR with no true arm and
// one unknown arm IS unknown. Getting this backwards is how unknowns silently
// collapse into falses.
function anyTrue(results: Truth[]): Truth {
  if (results.includes('true')) return 'true'
  return results.includes('unknown') ? 'unknown' : 'false'
}

function allTrue(results: Truth[]): Truth {
  if (results.includes('false')) return 'false'
  return results.includes('unknown') ? 'unknown' : 'true'
}

const negate = (value: Truth): Truth =>
  value === 'true' ? 'false' : value === 'false' ? 'true' : 'unknown'

// `gt`/`lt`/… compare a number against the numeric suffix of `key:value`
// options. PF2e reads every option matching `^key:(.+)$`, so the comparison is
// over whatever values the set happens to carry.
function testBinary(
  operator: string,
  left: string,
  right: string | number,
  options: RollOptionSet
): Truth {
  if (operator === 'eq') {
    // PF2e's own asymmetry: a string right-hand side is a literal comparison, a
    // numeric one is a lookup for the composed option.
    if (typeof right === 'string') return left === right ? 'true' : 'false'
    const composed = `${left}:${right}`
    return options.knows(composed) ? (options.has(composed) ? 'true' : 'false') : 'unknown'
  }

  const numeric = (operand: string | number): number[] | null => {
    const direct = Number(operand)
    if (!Number.isNaN(direct)) return [direct]
    // A bare key: read the numbers off `key:<n>` options. Unanswerable unless
    // the engine claims to enumerate that family.
    if (!options.knows(`${operand}:0`) && !options.knows(String(operand))) return null
    const found: number[] = []
    for (let candidate = 0; candidate <= 30; candidate++) {
      if (options.has(`${operand}:${candidate}`)) found.push(candidate)
    }
    return found.length > 0 ? found : null
  }

  const lefts = numeric(left)
  const rights = numeric(right)
  if (!lefts || !rights) return 'unknown'

  const compare: Record<string, (a: number, b: number) => boolean> = {
    gt: (a, b) => a > b,
    gte: (a, b) => a >= b,
    lt: (a, b) => a < b,
    lte: (a, b) => a <= b
  }
  const op = compare[operator]
  if (!op) return 'unknown'
  return lefts.some((a) => rights.every((b) => op(a, b))) ? 'true' : 'false'
}

export function testStatement(statement: PredicateStatement, options: RollOptionSet): Truth {
  if (typeof statement === 'string') {
    if (!statement) return 'false'
    return options.knows(statement) ? (options.has(statement) ? 'true' : 'false') : 'unknown'
  }
  if (!isRecord(statement)) return 'unknown'

  const entries = Object.entries(statement)
  if (entries.length !== 1) return 'unknown'
  const [key, value] = entries[0]

  // Binary operators: { gt: ["self:level", 5] }
  if (['eq', 'gt', 'gte', 'lt', 'lte'].includes(key)) {
    if (!Array.isArray(value) || value.length !== 2) return 'unknown'
    const [left, right] = value as [unknown, unknown]
    if (typeof left !== 'string') return 'unknown'
    if (typeof right !== 'string' && typeof right !== 'number') return 'unknown'
    return testBinary(key, left, right, options)
  }

  const asList = (input: unknown): PredicateStatement[] | null =>
    Array.isArray(input) ? (input as PredicateStatement[]) : null

  switch (key) {
    case 'and': {
      const list = asList(value)
      return list ? allTrue(list.map((s) => testStatement(s, options))) : 'unknown'
    }
    case 'or': {
      const list = asList(value)
      return list ? anyTrue(list.map((s) => testStatement(s, options))) : 'unknown'
    }
    case 'nand': {
      const list = asList(value)
      return list ? negate(allTrue(list.map((s) => testStatement(s, options)))) : 'unknown'
    }
    case 'nor': {
      const list = asList(value)
      return list ? negate(anyTrue(list.map((s) => testStatement(s, options)))) : 'unknown'
    }
    case 'not':
      return negate(testStatement(value as PredicateStatement, options))
    case 'xor': {
      const list = asList(value)
      if (!list) return 'unknown'
      const results = list.map((s) => testStatement(s, options))
      if (results.includes('unknown')) return 'unknown'
      return results.filter((r) => r === 'true').length === 1 ? 'true' : 'false'
    }
    case 'if': {
      // PF2e spells this { if: <antecedent>, then: <consequent> }, so the pair
      // arrives as one object with two keys and never reaches here as `if`
      // alone. Handled by the two-key branch below.
      return 'unknown'
    }
    default:
      return 'unknown'
  }
}

// A whole predicate: an implicit AND over its statements, with PF2e's two-key
// `if`/`then` and `iff` forms handled before the single-key dispatch.
export function testPredicate(
  predicate: readonly PredicateStatement[] | undefined,
  options: RollOptionSet
): Truth {
  if (!predicate || predicate.length === 0) return 'true'
  return allTrue(
    predicate.map((statement) => {
      if (isRecord(statement)) {
        const keys = Object.keys(statement)
        if (keys.length === 2 && 'if' in statement && 'then' in statement) {
          const antecedent = testStatement(statement.if as PredicateStatement, options)
          if (antecedent === 'false') return 'true'
          const consequent = testStatement(statement.then as PredicateStatement, options)
          if (antecedent === 'unknown') return consequent === 'true' ? 'true' : 'unknown'
          return consequent
        }
        if (keys.length === 2 && 'iff' in statement) return 'unknown'
      }
      return testStatement(statement, options)
    })
  )
}
