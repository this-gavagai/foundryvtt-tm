import { useServerAddressStore } from '@/stores/serverAddress'

export function getPath(path: string) {
  if (!path || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) return path

  const serverAddressStore = useServerAddressStore()
  if (serverAddressStore.isNativeMobile && serverAddressStore.serverUrl) {
    return new URL(path, serverAddressStore.serverUrl).href
  }

  return '../../' + path
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

export function isString(value: string | undefined | null): value is string {
  return !!value
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
