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

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  floor: ([a]) => Math.floor(a),
  ceil: ([a]) => Math.ceil(a),
  round: ([a]) => Math.round(a),
  abs: ([a]) => Math.abs(a),
  min: (args) => Math.min(...args),
  max: (args) => Math.max(...args)
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
function parse(tokens: Token[]): number | null {
  let pos = 0
  const peek = () => tokens[pos]

  function expression(): number | null {
    let left = term()
    if (left === null) return null
    for (;;) {
      const token = peek()
      if (token?.kind !== 'op' || (token.text !== '+' && token.text !== '-')) return left
      pos++
      const right = term()
      if (right === null) return null
      left = token.text === '+' ? left + right : left - right
    }
  }

  function term(): number | null {
    let left = factor()
    if (left === null) return null
    for (;;) {
      const token = peek()
      if (token?.kind !== 'op' || !'*/%'.includes(token.text)) return left
      pos++
      const right = factor()
      if (right === null) return null
      if (token.text === '*') left = left * right
      else if (token.text === '/') {
        if (right === 0) return null
        left = left / right
      } else {
        if (right === 0) return null
        left = left % right
      }
    }
  }

  function factor(): number | null {
    const token = peek()
    if (!token) return null
    if (token.kind === 'op' && token.text === '-') {
      pos++
      const inner = factor()
      return inner === null ? null : -inner
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
      if (!fn) return null
      pos++
      if (peek()?.kind !== 'paren' || (peek() as { text: string }).text !== '(') return null
      pos++
      const args: number[] = []
      for (;;) {
        const arg = expression()
        if (arg === null) return null
        args.push(arg)
        const next = peek()
        if (next?.kind === 'comma') {
          pos++
          continue
        }
        break
      }
      const close = peek()
      if (close?.kind !== 'paren' || close.text !== ')') return null
      pos++
      return fn(args)
    }
    if (token.kind === 'paren' && token.text === '(') {
      pos++
      const inner = expression()
      if (inner === null) return null
      const close = peek()
      if (close?.kind !== 'paren' || close.text !== ')') return null
      pos++
      return inner
    }
    return null
  }

  const result = expression()
  return result !== null && pos === tokens.length ? result : null
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
  const value = parse(tokens)
  if (value === null || !Number.isFinite(value)) return unresolved(`unevaluable formula "${trimmed}"`)
  return { ok: true, value }
}
