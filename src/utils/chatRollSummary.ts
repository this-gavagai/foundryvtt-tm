export interface RollTermJson {
  class?: string
  options?: {
    flavor?: string | null
    damageKind?: unknown
    damageType?: unknown
    kind?: unknown
    kinds?: unknown
    result?: unknown
    type?: unknown
    types?: unknown
    [key: string]: unknown
  }
  formula?: string
  terms?: RollTermJson[]
  operands?: RollTermJson[]
  term?: RollTermJson
  rolls?: RollJson[]
  dice?: RollTermJson[]
  die?: RollTermJson
  results?: Array<{ result?: number; active?: boolean }>
  number?: number
  faces?: number
  total?: number
  damageKind?: unknown
  damageType?: unknown
  kind?: unknown
  kinds?: unknown
  result?: unknown
  type?: unknown
  types?: unknown
  [key: string]: unknown
}

export interface RollJson extends RollTermJson {
  evaluated?: boolean
}

export interface ChatRollDie {
  formula: string
  flavor?: string
  faces?: number
  results: number[]
}

export interface ChatRollSummary {
  className?: string
  formula?: string
  total?: number
  flavors: string[]
  dice: ChatRollDie[]
  isHealing: boolean
}

export function parseRollJson(roll: string | RollJson | undefined): RollJson | undefined {
  if (!roll) return undefined
  if (typeof roll !== 'string') return roll
  try {
    const parsed = JSON.parse(roll)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function formulaFlavors(formula: string | undefined): string[] {
  if (!formula) return []
  return Array.from(formula.matchAll(/\[([^\]]+)\]/g))
    .flatMap((match) => match[1].split(','))
    .map((flavor) => flavor.trim())
    .filter(Boolean)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string')
  if (value instanceof Set) {
    return Array.from(value).filter((entry): entry is string => typeof entry === 'string')
  }
  return []
}

function recordKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Set) return []
  return Object.keys(value)
}

function nestedRecordKeys(value: unknown, keys: string[]): string[] {
  let current = value
  for (const key of keys) {
    if (!current || typeof current !== 'object') return []
    current = (current as Record<string, unknown>)[key]
  }
  return recordKeys(current)
}

function nestedValue(value: unknown, keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function isDieTerm(term: RollTermJson): boolean {
  return term.class === 'Die' || !!(term.faces && term.number)
}

function termDamageKind(term: RollTermJson): string[] {
  const options = term.options ?? {}
  return [
    ...stringValues(term.kinds),
    ...stringValues(options.kinds),
    ...stringValues(term.kind),
    ...stringValues(options.kind),
    ...stringValues(term.damageKind),
    ...stringValues(options.damageKind)
  ]
}

function termDamageType(term: RollTermJson): string | undefined {
  const options = term.options ?? {}
  return (
    stringValue(term.damageType) ??
    stringValue(term.type) ??
    stringValue(options.damageType) ??
    stringValue(options.type) ??
    stringValue(options.flavor) ??
    formulaFlavors(term.formula)[0]
  )
}

function rollDamageTypes(roll: RollJson): string[] {
  return [
    ...recordKeys(roll.types),
    ...recordKeys(roll.options?.types),
    ...nestedRecordKeys(roll.result, ['types']),
    ...nestedRecordKeys(roll.options?.result, ['types'])
  ]
}

function collectRollTerms(
  term: RollTermJson | undefined,
  out: RollTermJson[] = [],
  seen = new Set<RollTermJson>()
): RollTermJson[] {
  if (!term || seen.has(term)) return out
  seen.add(term)
  out.push(term)

  const dieCountBeforeChildren = out.filter(isDieTerm).length
  term.terms?.forEach((child) => collectRollTerms(child, out, seen))
  term.operands?.forEach((child) => collectRollTerms(child, out, seen))
  collectRollTerms(term.term, out, seen)
  collectRollTerms(term.die, out, seen)
  term.rolls?.forEach((child) => collectRollTerms(child, out, seen))
  const childTraversalFoundDice = out.filter(isDieTerm).length > dieCountBeforeChildren
  if (!childTraversalFoundDice) {
    term.dice?.forEach((child) => collectRollTerms(child, out, seen))
  }

  return out
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)))
}

function dieResults(term: RollTermJson): number[] {
  return (
    term.results
      ?.filter((result) => result.active !== false && typeof result.result === 'number')
      .map((result) => result.result as number) ?? []
  )
}

function dieFormula(term: RollTermJson): string | undefined {
  if (term.formula) return term.formula
  if (term.number && term.faces) return `${term.number}d${term.faces}`
  return undefined
}

function diceFromDamageResults(roll: RollJson): ChatRollDie[] {
  const diceResults =
    nestedValue(roll.result, ['diceResults']) ?? nestedValue(roll.options?.result, ['diceResults'])
  if (!diceResults || typeof diceResults !== 'object') return []

  const dice: ChatRollDie[] = []
  Object.entries(diceResults as Record<string, unknown>).forEach(([damageType, byKind]) => {
    if (!byKind || typeof byKind !== 'object') return
    Object.entries(byKind as Record<string, unknown>).forEach(([kind, results]) => {
      if (!Array.isArray(results)) return
      const byFaces = new Map<number, number[]>()
      results.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return
        const faces = (entry as { faces?: unknown }).faces
        const result = (entry as { result?: unknown }).result
        if (typeof faces !== 'number' || typeof result !== 'number') return
        byFaces.set(faces, [...(byFaces.get(faces) ?? []), result])
      })
      byFaces.forEach((values, faces) => {
        dice.push({
          formula: `${values.length}d${faces}`,
          flavor: kind === 'base' ? damageType : `${damageType} ${kind}`,
          faces,
          results: values
        })
      })
    })
  })

  return dice
}

export function rollSummary(roll: string | RollJson | undefined): ChatRollSummary | undefined {
  const parsed = parseRollJson(roll)
  if (!parsed) return undefined

  const terms = collectRollTerms(parsed)
  const dice = terms.filter(isDieTerm).map((term) => ({
    formula: dieFormula(term) ?? 'die',
    flavor: term.options?.flavor ?? formulaFlavors(term.formula)[0],
    faces: term.faces,
    results: dieResults(term)
  }))
  const damageResultDice = diceFromDamageResults(parsed)
  const displayDice = dice.some((die) => die.results.length) ? dice : damageResultDice

  const flavors = uniqueStrings([
    ...terms.map((term) => term.options?.flavor),
    ...terms.flatMap((term) => formulaFlavors(term.formula))
  ])
  const damageKinds = uniqueStrings(terms.flatMap(termDamageKind))
  const damageTypes = uniqueStrings([...terms.map(termDamageType), ...rollDamageTypes(parsed)])

  if (
    !displayDice.length &&
    !flavors.length &&
    !parsed.formula &&
    typeof parsed.total !== 'number'
  ) {
    return undefined
  }

  return {
    className: parsed.class,
    formula: parsed.formula,
    total: typeof parsed.total === 'number' ? parsed.total : undefined,
    flavors,
    dice: displayDice,
    isHealing:
      damageKinds.some((kind) => kind.toLowerCase() === 'healing') ||
      damageTypes.some((type) => type.toLowerCase() === 'healing')
  }
}

export function rollSummaries(rolls: Array<string | RollJson> | undefined): ChatRollSummary[] {
  return rolls?.map(rollSummary).filter((roll): roll is ChatRollSummary => !!roll) ?? []
}
