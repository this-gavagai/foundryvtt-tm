// A rule element's `value`, resolved as far as source data honestly allows.
//
// PF2e evaluates these with `Roll.safeEval` over `Roll.replaceFormulaData(...,
// this.actor.getRollData())` — and `getRollData()` returns `{ actor: this }`,
// the LIVE PREPARED actor. So `@actor.abilities.str.mod` resolves through the
// very derivation the engine is trying to perform. That circularity is not a
// detail to work around; it is the reason this returns a three-way result
// rather than a number.
//
// The arithmetic is reimplemented rather than delegated because neither Roll nor
// eval exists here: a small recursive-descent parser over `+ - * / %`,
// parentheses, unary minus and PF2e's usual function set. Anything it does not
// recognise is unresolvable, never a guess.

export type Resolution =
  | { ok: true; value: number }
  | { ok: false; reason: string }

const unresolved = (reason: string): Resolution => ({ ok: false, reason })

// The paths the engine is willing to answer. Deliberately a whitelist of things
// that exist in SOURCE data — everything else about the actor is derived, which
// is precisely what makes it unanswerable here.
export interface ValueContext {
  // `@actor.level` and friends. Only source-derivable entries belong in here.
  paths: Record<string, number>
  // `@item.badge.value` for a badged effect (Frightened 2, a stance's counter).
  itemBadge?: number
}

// PF2e installs its own helpers onto `Math` at startup, and content uses them
// heavily — Untrained Improvisation's value is a `match`/`when` chain, and rank
// upgrades commonly use `ternary`. They are the largest single source of
// unresolvable values on a real character, so they are reproduced here verbatim.
//
// Note the types: `when` returns NULL when its condition is false, `match` picks
// the first non-null, and the comparisons return BOOLEANS. So the evaluator
// works over `number | boolean | null` rather than numbers, and coerces only at
// the very end. A number-only evaluator cannot express `when` at all.
type Val = number | boolean | null

// Arithmetic coercion, matching what JavaScript does when these reach an
// operator: false/null are 0, true is 1.
const num = (value: Val): number => (value === null ? 0 : typeof value === 'boolean' ? (value ? 1 : 0) : value)

const FUNCTIONS: Record<string, (args: Val[]) => Val> = {
  floor: ([a]) => Math.floor(num(a)),
  ceil: ([a]) => Math.ceil(num(a)),
  round: ([a]) => Math.round(num(a)),
  abs: ([a]) => Math.abs(num(a)),
  min: (args) => Math.min(...args.map(num)),
  max: (args) => Math.max(...args.map(num)),
  // PF2e's additions, copied from its `Math.*` assignments.
  eq: ([a, b]) => num(a) === num(b),
  ne: ([a, b]) => num(a) !== num(b),
  gt: ([a, b]) => num(a) > num(b),
  gte: ([a, b]) => num(a) >= num(b),
  lt: ([a, b]) => num(a) < num(b),
  lte: ([a, b]) => num(a) <= num(b),
  btwn: ([a, min, max]) => num(a) >= num(min) && num(a) <= num(max),
  ternary: ([condition, a, b]) => (condition ? a : b),
  // `when` is the only one that can yield null, and `match` is the only thing
  // that reads null as meaningful — they are designed as a pair.
  when: ([condition, value]) => (condition ? value : null),
  match: (args) => args.find((arg) => arg !== null) ?? 0
}

type Token = { kind: 'num'; value: number } | { kind: 'op' | 'name' | 'paren' | 'comma'; text: string }

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const char = input[i]
    if (/\s/.test(char)) {
      i++
      continue
    }
    if (/[0-9.]/.test(char)) {
      const match = /^[0-9]*\.?[0-9]+/.exec(input.slice(i))
      if (!match) return null
      tokens.push({ kind: 'num', value: Number(match[0]) })
      i += match[0].length
      continue
    }
    if ('+-*/%'.includes(char)) {
      tokens.push({ kind: 'op', text: char })
      i++
      continue
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', text: char })
      i++
      continue
    }
    if (char === ',') {
      tokens.push({ kind: 'comma', text: ',' })
      i++
      continue
    }
    if (/[a-z_]/i.test(char)) {
      const match = /^[a-z_][a-z0-9_]*/i.exec(input.slice(i))
      if (!match) return null
      tokens.push({ kind: 'name', text: match[0].toLowerCase() })
      i += match[0].length
      continue
    }
    return null
  }
  return tokens
}

// Recursive descent: expression → term → factor. Small enough to read, and it
// refuses anything it was not built for instead of falling through to eval.
function parse(tokens: Token[]): Val | undefined {
  let pos = 0
  const peek = () => tokens[pos]

  function expression(): Val | undefined {
    let left = term()
    if (left === undefined) return undefined
    for (;;) {
      const token = peek()
      if (token?.kind !== 'op' || (token.text !== '+' && token.text !== '-')) return left
      pos++
      const right = term()
      if (right === undefined) return undefined
      left = token.text === '+' ? num(left) + num(right) : num(left) - num(right)
    }
  }

  function term(): Val | undefined {
    let left = factor()
    if (left === undefined) return undefined
    for (;;) {
      const token = peek()
      if (token?.kind !== 'op' || !'*/%'.includes(token.text)) return left
      pos++
      const right = factor()
      if (right === undefined) return undefined
      const a = num(left)
      const b = num(right)
      if (token.text === '*') left = a * b
      else if (token.text === '/') {
        if (b === 0) return undefined
        left = a / b
      } else {
        if (b === 0) return undefined
        left = a % b
      }
    }
  }

  function factor(): Val | undefined {
    const token = peek()
    if (!token) return undefined
    if (token.kind === 'op' && token.text === '-') {
      pos++
      const inner = factor()
      return inner === undefined ? undefined : -num(inner)
    }
    if (token.kind === 'op' && token.text === '+') {
      pos++
      return factor()
    }
    if (token.kind === 'num') {
      pos++
      return token.value
    }
    if (token.kind === 'name') {
      const fn = FUNCTIONS[token.text]
      if (!fn) return undefined
      pos++
      if (peek()?.kind !== 'paren' || (peek() as { text: string }).text !== '(') return undefined
      pos++
      const args: Val[] = []
      for (;;) {
        const arg = expression()
        if (arg === undefined) return undefined
        args.push(arg)
        const next = peek()
        if (next?.kind === 'comma') {
          pos++
          continue
        }
        break
      }
      const close = peek()
      if (close?.kind !== 'paren' || close.text !== ')') return undefined
      pos++
      return fn(args)
    }
    if (token.kind === 'paren' && token.text === '(') {
      pos++
      const inner = expression()
      if (inner === undefined) return undefined
      const close = peek()
      if (close?.kind !== 'paren' || close.text !== ')') return undefined
      pos++
      return inner
    }
    return undefined
  }

  const result = expression()
  return result !== undefined && pos === tokens.length ? result : undefined
}

// Substitute `@path` references. A path the context does not carry makes the
// whole formula unresolvable — the single most important refusal in this file,
// because most of what a rule element wants to read about an actor is derived.
function substitute(formula: string, context: ValueContext): string | null {
  let failed = false
  const replaced = formula.replace(/@([a-z0-9._]+)/gi, (_match, path: string) => {
    if (path === 'item.badge.value' && typeof context.itemBadge === 'number') {
      return String(context.itemBadge)
    }
    const value = context.paths[path]
    if (typeof value !== 'number') {
      failed = true
      return '0'
    }
    return String(value)
  })
  return failed ? null : replaced
}

// PF2e's bracketed form: a value that steps by some other quantity, almost
// always the actor's level. `{ field?, brackets: [{ start?, end?, value }] }`.
interface Bracketed {
  field?: string
  brackets: { start?: number; end?: number; value: unknown }[]
}

const isBracketed = (value: unknown): value is Bracketed =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { brackets?: unknown }).brackets)

export function resolveValue(raw: unknown, context: ValueContext): Resolution {
  if (typeof raw === 'number') return { ok: true, value: raw }
  if (typeof raw === 'boolean') return { ok: true, value: raw ? 1 : 0 }
  if (raw === null || raw === undefined) return { ok: true, value: 0 }

  if (isBracketed(raw)) {
    // The bracket key defaults to the actor's level, which is source data. A
    // bracket keyed on anything else is refused rather than guessed at.
    const field = raw.field ?? 'actor|system.details.level.value'
    const keyed = field.includes('level') ? context.paths['actor.level'] : undefined
    if (typeof keyed !== 'number') return unresolved(`bracket field ${field}`)
    const match = raw.brackets.find(
      (bracket) =>
        (bracket.start === undefined || keyed >= bracket.start) &&
        (bracket.end === undefined || keyed <= bracket.end)
    )
    if (!match) return { ok: true, value: 0 }
    return resolveValue(match.value, context)
  }

  if (typeof raw !== 'string') return unresolved('unsupported value shape')

  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: 0 }

  const substituted = substitute(trimmed, context)
  if (substituted === null) return unresolved(`unreachable path in "${trimmed}"`)

  const tokens = tokenize(substituted)
  if (!tokens) return unresolved(`unparsable formula "${trimmed}"`)
  const parsed = parse(tokens)
  if (parsed === undefined) return unresolved(`unevaluable formula "${trimmed}"`)
  // A whole expression resolving to null (an unmatched `when`) is zero, which is
  // what `match`'s own `?? 0` does and what Number(null) would give.
  const value = num(parsed)
  if (!Number.isFinite(value)) return unresolved(`unevaluable formula "${trimmed}"`)
  return { ok: true, value }
}
