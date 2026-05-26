import type { DiceResults } from '@/types/api-types'

// Parse a Foundry/PF2e damage formula into an ordered list of die-face labels,
// one entry per physical die.
//
//   "1d8+5"            → ['d8']
//   "2d6+1d4[fire]"    → ['d6', 'd6', 'd4']
//   "(1d6+2)[fire]"    → ['d6']
//   "{2d6}[persistent,fire] + 1d4[acid]" → ['d6', 'd6', 'd4']
//
// Only NdM terms count. Bracketed [type] annotations and {grouping} braces
// contain no XdY patterns, so they're naturally ignored.
export function parseDamageFormulaDice(formula: string | undefined): string[] {
  if (!formula) return []
  const out: string[] = []
  const re = /(\d+)d(\d+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(formula)) !== null) {
    const count = Number(match[1])
    const faces = match[2]
    for (let i = 0; i < count; i++) out.push('d' + faces)
  }
  return out
}

// Convert an ordered face array, aligned to a dice declaration list, into a
// DiceResults payload grouped by face count.
//
//   dice=['d6','d6','d4'], faces=[3,5,2] → { d6: [3, 5], d4: [2] }
export function makeDiceResults(dice: string[], faces: number[]): DiceResults {
  const out: DiceResults = {}
  dice.forEach((d, i) => {
    const key = d as keyof DiceResults
    if (!out[key]) out[key] = []
    out[key]!.push(faces[i])
  })
  return out
}
