import { createI18n } from 'vue-i18n'
import en from '@/locales/en.json'
import de from '@/locales/de.json'

const LOCALE_STORAGE_KEY = 'tm-locale'

// Languages offered in the sidebar selector. Add an entry here (and a matching
// catalog import above) when shipping a new translation.
export const availableLocales = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' }
]

// Language is a client-side preference, cached in localStorage. Defaults to 'en'.
function getInitialLocale(): string {
  return localStorage.getItem(LOCALE_STORAGE_KEY) ?? 'en'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: getInitialLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    de
  }
})

// Set the active language and persist the choice.
export function setLocale(lang: string) {
  const locale = i18n.global.locale as { value: string }
  locale.value = lang
  localStorage.setItem(LOCALE_STORAGE_KEY, lang)
}
