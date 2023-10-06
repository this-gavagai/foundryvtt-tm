function isObject(item: any) {
  return item && typeof item === 'object' && !Array.isArray(item) && item !== null
}
export function mergeDeep(target: any, source: any) {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} })
        mergeDeep(target[key], source[key])
      } else {
        Object.assign(target, { [key]: source[key] })
      }
    }
  }
  return target
}

export function capitalize(s: string) {
  return s?.[0]?.toUpperCase() + s?.slice(1)
}
export function makeTraits(traits: [string]): string {
  // todo: on boost eidolon spell: traits for "Arcane" and "Concentrate" are missing
  let list = traits?.reduce((list, t) => {
    return (list += `<span class="bg-[#5E0000] text-[0.5rem] text-white px-1 uppercase">${t}${'\n'}</span>`)
  }, '')
  list = `<div class="flex flex-wrap gap-1 pb-1">${list}</div>`
  return list
}
export function makeActionIcons(actionValue: string): string {
  return `<span class="pf2-icon">${actionValue?.replace('to', '-')}</span>`
}
export function makePropertiesHtml(item: any): string {
  return (
    (item.system?.duration?.value
      ? `<div><span class='font-bold'>Duration:</span> ${item.system.duration?.value}</div>`
      : ``) +
    (item.system?.area?.value
      ? `<div><span class='font-bold'>Area:</span> ${item.system.area.value} ft ${item.system.area.type}</div>`
      : ``) +
    (item.system?.target?.value
      ? `<div><span class='font-bold'>Target:</span> ${item.system.target?.value}</div>`
      : ``) +
    (item.system?.save?.value
      ? `<p><span class='font-bold'>Save:</span> ${
          item.system?.save?.basic ? capitalize(item.system?.save?.basic) : ``
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

export function removeUUIDs(description: string) {
  // todo: remove [[]] (shocking grasp)
  // todo: give tooltip on linked object?
  // todo: move this to utility
  return description?.replace(
    /@(UUID|Compendium)\[.*?\]\{(.*?)\}/gm,
    '<span class="text-red-900">$2</span>'
  )
}

export const SignedNumber = new Intl.NumberFormat('en-US', {
  signDisplay: 'always'
})
