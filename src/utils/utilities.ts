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

export const SignedNumber = new Intl.NumberFormat('en-US', {
  signDisplay: 'always'
})
export function formatModifier(n: number | string | undefined) {
  return typeof n !== 'number' || isNaN(n) ? '??' : SignedNumber.format(n)
}

export function getPath(path: string) {
  return path.slice(0, 4) === 'http' ? path : '../../' + path
}

// Focus + select-all on the input that fired the event. Used as a click
// handler on numeric inputs where we want the existing value pre-selected
// so the user can immediately overwrite it.
export function selectAllOnClick(e: Event) {
  const field = e.target as HTMLInputElement
  field.focus()
  field.select()
}

export function parseIncrement(input: string, startingValue: number): number {
  const transform = [...input.matchAll(/([\+\-]){0,1}([0-9]+)$/g)]?.[0]
  if (!transform) return startingValue
  let newValue: number
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

const isProd = import.meta.env.MODE === 'production'
export const logger = {
  debug: (...args: unknown[]) => {
    if (!isProd) console.debug(...args)
  },
  info: (...args: unknown[]) => {
    if (!isProd) console.info(...args)
  },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args)
}
