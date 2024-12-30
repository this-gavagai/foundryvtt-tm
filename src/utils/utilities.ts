interface ItemPartial {
  system: {
    duration?: { value: number }
    area?: { value: number; type: string }
    target?: { value: string }
    range?: { value: number }
    save?: { value: string; basic: string }
  }
}

// export function capitalize(s: string | undefined) {
//   return s ? s?.[0]?.toUpperCase() + s?.slice(1) : null
// }
export function makeTraits(traits: string[] | undefined): string {
  let list = traits?.reduce((list, t) => {
    return (list += `<span class="bg-[#5E0000] text-[0.5rem] text-white px-1 uppercase">${t}${'\n'}</span>`)
  }, '')
  list = `<div class="flex flex-wrap gap-1 pb-1">${list}</div>`
  return list
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
    (item?.system?.target?.value
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

export function removeUUIDs(description: string | undefined) {
  const inline_actions = /\[\[\/act (?<slug>[^\s]+)[\s]*(?<params>.*?)\]\](\{(?<label>.+?)\})?/gm
  description = description?.replace(
    inline_actions,
    (match, p1, p2, p3, p4, offset, string, groups) =>
      `<label class="has-[:checked]:bg-green-300 transition-all duration-50 bg-gray-300 border-gray-400 border -my-1 p-1 mx-1 cursor-pointer">
        <input class="fixed opacity-0 pointer-events-none" type="radio" name="roll" value="${groups.slug}">
        ${groups.label ?? groups.slug}
      </label>`
  )

  const changed = description
    ?.replace(/@(UUID|Compendium)\[.*?\]\{(.*?)\}/gm, '<span class="text-red-900">$2</span>')
    ?.replace(/\[\[\/r (.*)\]\]/gm, '<span class="text-green-900">$1</span>')

  return changed
}

export const SignedNumber = new Intl.NumberFormat('en-US', {
  signDisplay: 'always'
})
export function formatModifier(n: number | string) {
  return typeof n !== 'number' || isNaN(n) ? '??' : SignedNumber.format(n)
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
  return newValue ?? startingValue
}

export function uuidv4() {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
  )
}
