// Settings-menu ApplicationV2 for the GM handler policy: which GMs handle
// Tablemate requests, and in what order. The stored shape lives in
// gmHandlerSetting.ts; this is only its editor.
//
// The menu keeps a DRAFT ordering on the instance rather than writing on every
// click, because reordering is inherently multi-step — you nudge a GM up twice,
// uncheck another, then save. Each ↑/↓ click re-renders from the draft, so the
// pending checkbox state has to be read out of the DOM into the draft first
// (#captureHandles below) or a re-render would discard it.
//
// The draft always holds EVERY current GM, unlisted ones included, ordered the
// way the election would rank them today. So the list shows exactly what the
// world does now, and saving makes that ordering explicit.

import type { UserPF2e } from '@7h3laughingman/pf2e-types'
import type FormDataExtended from '@7h3laughingman/foundry-types/client/applications/ux/form-data-extended.mjs'
import {
  collapseGmHandlerPolicy,
  compareGmHandlers,
  gmHandlerPolicy,
  gmHandlesRequests,
  saveGmHandlerPolicy,
  type GmHandlerPolicy
} from './gmHandlerSetting'

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

// Settings-menu key, shared with the registerMenu call and the settings-config
// section header that anchors to this menu's button.
export const GM_HANDLER_MENU_KEY = 'gmHandlerMenu'

declare interface GmHandlerRow {
  id: string
  name: string
  // Connected right now — the election only considers active GMs, so this is
  // what makes the list legible ("Alice is first but she's offline").
  online: boolean
  handles: boolean
  // Priority label: position among handlers, or an em dash when opted out.
  rank: string
  // The GM this world would hand the next request to, given who is online.
  answering: boolean
  isFirst: boolean
  isLast: boolean
}
declare interface GmHandlerContext {
  rows: GmHandlerRow[]
  // No online GM will handle requests: every online GM is opted out (or none is
  // connected at all).
  noHandler: boolean
  buttons: { type: string; action?: string; icon?: string; label: string }[]
  tabs?: undefined
}

interface Draft {
  order: string[]
  ignored: Set<string>
}

// An unconfigured world: no opt-outs, no explicit order (so GMs rank by id).
const DEFAULT_POLICY: GmHandlerPolicy = { order: [], ignored: [] }

export class GmHandlerMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'TablemateGmHandlerMenu',
    actions: {
      moveUp: GmHandlerMenu.moveHandler,
      moveDown: GmHandlerMenu.moveHandler,
      resetHandlers: GmHandlerMenu.resetHandlers
    },
    window: {
      title: 'GM handler priority',
      icon: 'fas fa-user-shield'
    },
    tag: 'form',
    form: {
      handler: GmHandlerMenu.saveHandlers,
      submitOnChange: false,
      closeOnSubmit: true
    },
    position: { width: 520 }
  }
  static PARTS = {
    form: {
      template: 'modules/tablemate/templates/gmHandlers.hbs'
    },
    footer: {
      template: 'templates/generic/form-footer.hbs'
    }
  }

  // Pending edits, built on first render and mutated by the ↑/↓ actions.
  #draft: Draft | null = null

  static gms(): UserPF2e[] {
    return game.users.filter((user: UserPF2e) => user.isGM)
  }

  // Seed the draft from the saved policy: current GMs in election order, with
  // the opt-outs carried over. Saved ids for GMs who no longer exist drop out
  // here, which is also how they get cleaned out of the setting on next save.
  #ensureDraft(gms: UserPF2e[]): Draft {
    if (this.#draft) return this.#draft
    const policy = gmHandlerPolicy()
    this.#draft = {
      order: [...gms].sort((a, b) => compareGmHandlers(a, b, policy)).map((user) => user.id),
      ignored: new Set(gms.filter((user) => !gmHandlesRequests(user, policy)).map((u) => u.id))
    }
    return this.#draft
  }

  // Fold the rendered checkboxes back into the draft. Called before any action
  // that re-renders, so an unsaved "Handles" toggle survives a reorder.
  #captureHandles() {
    const form = this.element as HTMLElement | null
    if (!form || !this.#draft) return
    for (const input of form.querySelectorAll<HTMLInputElement>('input[data-handles-for]')) {
      const id = input.dataset.handlesFor
      if (!id) continue
      if (input.checked) this.#draft.ignored.delete(id)
      else this.#draft.ignored.add(id)
    }
  }

  async _prepareContext(): Promise<GmHandlerContext> {
    const gms = GmHandlerMenu.gms()
    const draft = this.#ensureDraft(gms)
    const byId = new Map(gms.map((user) => [user.id, user]))
    const ids = draft.order.filter((id) => byId.has(id))

    let handlerCount = 0
    let answeringFound = false
    const rows: GmHandlerRow[] = ids.map((id, index) => {
      const user = byId.get(id)!
      const handles = !draft.ignored.has(id)
      const online = !!user.active
      if (handles) handlerCount++
      // First online handler in priority order wins the live election.
      const answering = handles && online && !answeringFound
      if (answering) answeringFound = true
      return {
        id,
        name: user.name ?? id,
        online,
        handles,
        rank: handles ? String(handlerCount) : '—',
        answering,
        isFirst: index === 0,
        isLast: index === ids.length - 1
      }
    })

    const buttons = [
      {
        type: 'button',
        action: 'resetHandlers',
        icon: 'fas fa-rotate-left',
        label: 'Reset to Default'
      },
      { type: 'submit', icon: 'fas fa-save', label: 'Save Changes' }
    ]
    return { rows, noHandler: !answeringFound, buttons }
  }

  // One handler for both ↑ and ↓: the direction comes from the action name, so
  // the two buttons differ only in their data-action.
  static async moveHandler(this: GmHandlerMenu, _event: Event, target: HTMLElement) {
    const id = target.dataset.userId
    const draft = this.#draft
    if (!id || !draft) return
    this.#captureHandles()
    const from = draft.order.indexOf(id)
    const to = from + (target.dataset.action === 'moveUp' ? -1 : 1)
    if (from < 0 || to < 0 || to >= draft.order.length) return
    draft.order.splice(to, 0, ...draft.order.splice(from, 1))
    await this.render()
  }

  // Back to the out-of-the-box election: nobody opted out, GMs ordered by user
  // id. Draft-only — nothing is persisted until Save, so a stray click here
  // followed by closing the window can't wipe the world's policy.
  static async resetHandlers(this: GmHandlerMenu) {
    this.#draft = {
      order: [...GmHandlerMenu.gms()]
        .sort((a, b) => compareGmHandlers(a, b, DEFAULT_POLICY))
        .map((user) => user.id),
      ignored: new Set()
    }
    await this.render()
  }

  static async saveHandlers(
    this: GmHandlerMenu,
    _event: Event,
    _form: HTMLFormElement,
    formData: FormDataExtended
  ) {
    const order = this.#draft?.order ?? []
    // The form is the authority on the checkboxes (it is being submitted, so its
    // values are current); the draft is the authority on the ordering, which has
    // no form field of its own.
    const ignored = order.filter((id) => !formData.object[`handles.${id}`])
    await saveGmHandlerPolicy(collapseGmHandlerPolicy({ order, ignored }))
  }
}
