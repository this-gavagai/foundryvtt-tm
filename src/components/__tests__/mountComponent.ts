import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import en from '@/locales/en.json'

// Mounting harness for the decisions that live only in a template.
//
// Most of this suite tests composables and pure utilities, and should keep doing
// that: a component test is slower, more brittle, and says less about why
// something is true. But a `v-if` gate has no seam a unit test can reach, and
// the audit that produced these specs found that the affordances nothing was
// gating were exactly the ones nothing could have caught — a Delete offered on a
// message Foundry refuses, an Apply Damage button that swallowed a tap for
// thirty seconds with no GM to answer it.
//
// So the rule this harness is for: when the ONLY statement of a rule is a
// `v-if` or a `:disabled`, mount and assert on it. When the rule can live in a
// composable instead, put it there and test it there.

// A real catalog rather than a stub, so an assertion can match the string a
// player actually sees, and a missing key fails instead of rendering its own
// name.
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

// Headless UI's Dialog and Transition are deliberately NOT stubbed. They pass
// state to their children through provide/inject, so a stub breaks the contract
// (`<DialogTitle /> is missing a parent <Dialog />`) — and with the teleport
// target below in place they render perfectly well in jsdom. Transitions resolve
// synchronously enough that one `nextTick` after a click is sufficient.

// Props are checked by the caller's own object literal against the component it
// names; the mount call itself is deliberately untyped, because @vue/test-utils'
// MountingOptions generic cannot be satisfied for an unresolved SFC without
// naming each component's props type at every call site.
type MountOptions = Record<string, unknown> & {
  global?: { plugins?: unknown[]; provide?: Record<string, unknown>; stubs?: unknown }
}

// Every modal in the app teleports its panel to `#modals` (see ModalBox), which
// index.html provides and a test DOM does not. Without it Vue warns and drops
// the panel on the floor, so anything inside a modal is simply absent — which is
// indistinguishable from the gate under test having hidden it.
// jsdom implements neither of these, and Headless UI's Dialog constructs a
// ResizeObserver on open while scroll-locking reads matchMedia. Minimal stand-ins
// rather than a stubbed Dialog: the real component then runs, so a gate inside a
// modal is asserted against the markup a player actually gets.
function ensureBrowserApis(): void {
  const w = globalThis as unknown as Record<string, unknown>
  w.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  w.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false
    })) as typeof window.matchMedia
  }
}

function ensureModalHost(): HTMLElement {
  const existing = document.getElementById('modals')
  if (existing) return existing
  const host = document.createElement('div')
  host.id = 'modals'
  document.body.append(host)
  return host
}

export function mountComponent(component: unknown, options: MountOptions = {}): VueWrapper {
  setActivePinia(createPinia())
  ensureBrowserApis()
  document.body.innerHTML = ''
  ensureModalHost()
  const global = options.global ?? {}
  return mount(
    component as never,
    {
      ...options,
      global: { ...global, plugins: [i18n, ...(global.plugins ?? [])] }
    } as never
  )
}

/** Buttons anywhere in the document, including a teleported modal panel. */
export function buttonTexts(): string[] {
  return [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim())
}
