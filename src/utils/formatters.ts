export function printPrice(
  price: { gp: number | undefined; sp: number | undefined; cp: number | undefined } | undefined
) {
  if (!price) return ''
  return [price?.gp, price?.sp, price?.cp]
    .map((x, i) => (x ? x + ['gp', 'sp', 'cp']?.[i] : undefined))
    .filter((x) => x !== undefined)
    .join(' ')
}

export const SignedNumber = new Intl.NumberFormat('en-US', {
  signDisplay: 'always'
})

export function formatModifier(n: number | string | undefined) {
  return typeof n !== 'number' || isNaN(n) ? '??' : SignedNumber.format(n)
}
