import type { Item } from '@/types/pf2e-types'

export function capitalize(s: string | undefined) {
  return s ? s?.[0]?.toUpperCase() + s?.slice(1) : null
}
export function makeTraits(traits: string[] | undefined): string {
  let list = traits?.reduce((list, t) => {
    return (list += `<span class="bg-[#5E0000] text-[0.5rem] text-white px-1 uppercase">${t}${'\n'}</span>`)
  }, '')
  list = `<div class="flex flex-wrap gap-1 pb-1">${list}</div>`
  return list
}
export function makeActionIcons(actionValue: string): string {
  return `<span class="pf2-icon">${actionValue?.replace('to', '-')}</span>`
}
export function makePropertiesHtml(item: Item): string {
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
    (item?.system?.target?.value
      ? `<div><span class='font-bold'>Range:</span> ${item?.system.range?.value}</div>`
      : ``) +
    (item?.system?.save?.value
      ? `<p><span class='font-bold'>Save:</span> ${
          item.system?.save?.basic ? capitalize(item?.system?.save?.basic) : ``
        } ${capitalize(item.system?.save?.value)}</p>`
      : ``)
  )
}

export function printPrice(price: { gp: Number; sp: Number; cp: Number }) {
  return [price?.gp, price?.sp, price?.cp]
    .map((x, i) => (x ? x + ['gp', 'sp', 'cp']?.[i] : undefined))
    .filter((x) => x !== undefined)
    .join(' ')
}

export function removeUUIDs(description: string | undefined) {
  return description
    ?.replace(/@(UUID|Compendium)\[.*?\]\{(.*?)\}/gm, '<span class="text-red-900">$2</span>')
    ?.replace(/\[\[\/r (.*)\]\]/gm, '<span class="text-green-900">$1</span>')
}

export const SignedNumber = new Intl.NumberFormat('en-US', {
  signDisplay: 'always'
})
export function formatModifier(n: number) {
  return isNaN(n) ? '??' : SignedNumber.format(n)
}

export function getPath(path: string) {
  // console.log('input path', path)
  return path.slice(0, 4) === 'http' ? path : '../../' + path
}

export function parseIncrement(input: string, startingValue: number): number {
  const transform = [...input.matchAll(/([\+\-]){0,1}([0-9]+)$/g)]?.[0]
  if (!transform) return startingValue
  let newValue: number
  // console.log([...input.matchAll(/([\+\-]){0,1}([0-9]+)$/g)])
  if (transform[1] === '+') {
    newValue = startingValue + (Number(transform[2]) ?? 0)
  } else if (transform[1] === '-') {
    newValue = startingValue - (Number(transform[2]) ?? 0)
  } else {
    newValue = Number(transform[2]) ?? startingValue
  }
  return newValue
}
