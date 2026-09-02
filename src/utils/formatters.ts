export function printPrice(
  price:
    | {
        pp?: number | undefined
        gp: number | undefined
        sp: number | undefined
        cp: number | undefined
      }
    | undefined
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
