import { createI18n } from 'vue-i18n'
import type en from '@/locales/en.json'

const LOCALE_STORAGE_KEY = 'tm-locale'

// Catalogs are auto-discovered from src/locales/*.json — dropping a new file in
// there is enough to make its translations load. Keyed by filename (e.g. 'de').
const catalogs = import.meta.glob('@/locales/*.json', {
  eager: true,
  import: 'default'
}) as Record<string, typeof en>
const messages = Object.fromEntries(
  Object.entries(catalogs).map(([path, msg]) => [path.match(/([^/]+)\.json$/)![1], msg])
)

// Human-readable label for a locale, in that language's own name (autonym),
// from the browser's CLDR data — no hand-maintained list to keep in sync.
function localeName(id: string): string {
  const name = new Intl.DisplayNames([id], { type: 'language' }).of(id) ?? id
  // CLDR lowercases autonyms in some languages (e.g. ru "русский"); title-case
  // the first letter for selector display.
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Languages offered in the sidebar selector, derived from the discovered
// catalogs so the list can never drift from what actually loaded. English is
// pinned first; the rest follow in discovery order.
export const availableLocales = Object.keys(messages)
  .sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : 0))
  .map((id) => ({
    id,
    name: localeName(id)
  }))

// Language is a client-side preference, cached in localStorage. Defaults to 'en'.
function getInitialLocale(): string {
  return localStorage.getItem(LOCALE_STORAGE_KEY) ?? 'en'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: getInitialLocale(),
  fallbackLocale: 'en',
  messages
})

// Set the active language and persist the choice.
export function setLocale(lang: string) {
  const locale = i18n.global.locale as { value: string }
  locale.value = lang
  localStorage.setItem(LOCALE_STORAGE_KEY, lang)
}
