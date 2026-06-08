interface ItemPartial {
  system: {
    duration?: { value: number }
    area?: { value: number; type: string }
    target?: { value: string }
    range?: { value: number }
    save?: { value: string; basic: string }
  }
}

export function makeActionIcons(actionValue: string | undefined): string {
  return `<span class="pf2-icon">${
    actionValue?.replace('to', '-').replace('free', 'f').replace('reaction', 'r') ?? ''
  }</span>`
}

export function makePropertiesHtml(item: ItemPartial | undefined): string {
  return (
    (item?.system?.duration?.value
      ? `<div><span class='font-bold'>Duration:</span> ${item?.system.duration?.value}</div>`
      : ``) +
    (item?.system?.area?.value
      ? `<div><span class='font-bold'>Area:</span> ${item?.system.area.value} ft ${item.system.area.type}</div>`
      : ``) +
    (item?.system?.target?.value
      ? `<div><span class='font-bold'>Target:</span> ${item?.system.target?.value}</div>`
      : ``) +
    (item?.system?.range?.value
      ? `<div><span class='font-bold'>Range:</span> ${item?.system.range?.value}</div>`
      : ``) +
    (item?.system?.save?.value
      ? `<p class="capitalize"><span class='font-bold'>Save:</span> ${
          item.system?.save?.basic ? item?.system?.save?.basic : ``
        } ${item.system?.save?.value}</p>`
      : ``)
  )
}

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
