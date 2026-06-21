import { useServerAddressStore } from '@/stores/serverAddress'
import { cachedImageSrc } from '@/api/imageCache'

// The last-selected character id, persisted per server origin so returning to a
// server resumes its character — and, crucially, so a *different* server never
// inherits a character id that only exists on the one you came from (which would
// otherwise strand the app on an invisible sheet for a foreign actor).
function lastCharacterIdKey(origin?: string): string {
  const o = origin ?? useServerAddressStore().serverUrl?.origin ?? ''
  return `tablemate.lastCharacterId:${o}`
}

export function getLastCharacterId(): string | null {
  return localStorage.getItem(lastCharacterIdKey())
}

export function setLastCharacterId(id: string): void {
  localStorage.setItem(lastCharacterIdKey(), id)
}

// Forget a server's remembered character. Called when the server is removed so
// a re-add doesn't auto-select a character left over from the deleted one.
export function clearLastCharacterId(origin: string): void {
  localStorage.removeItem(lastCharacterIdKey(origin))
}

export function getPath(path: string) {
  if (!path || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) return path

  const serverAddressStore = useServerAddressStore()
  if (serverAddressStore.isNativeMobile && serverAddressStore.serverUrl) {
    // Resolve to the remote asset URL, then let the native image cache hand
    // back a local file:// copy when one exists (reactive: a render re-runs
    // and swaps the src once a background download lands).
    return cachedImageSrc(new URL(path, serverAddressStore.serverUrl).href)
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
