// Every denomination optional, because a STORED price really is sparse — a
// torch is `{cp: 1}` and a bedroll `{cp: 2}`, with the other three keys absent.
// PF2e normalizes them to all four at prepare time, so the strict shape was
// describing the prepared form of a field the sheet also reads unprepared. The
// body already skips anything falsy.
export function printPrice(
  price: Partial<Record<'pp' | 'gp' | 'sp' | 'cp', number | undefined>> | undefined
) {
  if (!price) return ''
  return [price?.pp, price?.gp, price?.sp, price?.cp]
    .map((x, i) => (x ? x + ['pp', 'gp', 'sp', 'cp']?.[i] : undefined))
    .filter((x) => x !== undefined)
    .join(' ')
}

export const SignedNumber = new Intl.NumberFormat('en-US', {
  signDisplay: 'always'
})

export function formatModifier(n: number | string | undefined) {
  return typeof n !== 'number' || isNaN(n) ? '??' : SignedNumber.format(n)
}

// Split a Bulk value into the two units players read it in: whole Bulk, plus
// the tenths PF2e calls "light". Bulk is stored as a float of tenths (0.1 per
// light item), so the split rounds into light units before dividing rather than
// flooring the float — ten light items summed by repeated addition land on
// 0.9999999999999999, which floors to 9L instead of reading as 1.
export function bulkParts(value: number | undefined) {
  const lightUnits = Math.max(0, Math.round((value ?? 0) * 10))
  return { normal: Math.floor(lightUnits / 10), light: lightUnits % 10 }
}

// What a whole stack of an item weighs, as PF2e's PhysicalItemPF2e#bulk
// computes it: `per` is the quantity a Bulk value is quoted for (10 for
// arrows), and anything short of a full stack is negligible — so the stack
// count FLOORS before it multiplies, and 5 of a 10-per item weigh nothing at
// all. Dividing the product instead (0.1 × 5 ÷ 10) quietly bills a partial
// stack for a partial Bulk, which is a unit the game does not have.
//
// `per` is missing for every item that doesn't stack, and missing from every
// item in a payload from an older Foundry-side build; both read as 1, which is
// PF2e's own default.
//
// One row is not the encumbrance meter, and they may legitimately disagree:
// ActorPF2e's computeTotalBulk groups same-base-item stacks and floors their
// COMBINED quantity, so two quivers of 5 arrows weigh a light between them
// while each row on its own reads as nothing. The meter is the actor's own
// figure (system.attributes.bulk) and is unaffected by this.
export function stackBulk(
  value: number | undefined,
  quantity: number | undefined,
  per: number | undefined
): number {
  const bulk = value ?? 0
  if (bulk <= 0) return 0
  const stackSize = per && per > 0 ? per : 1
  return bulk * Math.floor((quantity ?? 0) / stackSize)
}
