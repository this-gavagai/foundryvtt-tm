// Settings-menu ApplicationV2 showing whether push notifications actually work,
// with a button to prove it. The checks themselves live in pushDiagnostics.ts;
// this is only their presentation.
//
// It exists because every failure in this feature is silent by construction: a
// failed provision, a relay that moved, a world where nobody opened the app all
// look identical from the GM's chair — no notifications and no error.

import { collectPushStatus, sendTestPush, type PushCheck, type PushStatus } from './pushDiagnostics'

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

// Settings-menu key, shared with the registerMenu call in tablemate.ts.
export const PUSH_STATUS_MENU_KEY = 'pushStatusMenu'

// Resolved here rather than in the template: the other Tablemate templates use
// only plain {{#if}}, so nothing depends on a comparison helper being registered.
const STATE_ICONS: Record<PushCheck['state'], string> = {
  ok: 'fa-circle-check',
  warn: 'fa-circle-exclamation',
  fail: 'fa-circle-xmark'
}

interface PushStatusContext extends Omit<PushStatus, 'checks'> {
  checks: Array<PushCheck & { icon: string }>
  // Present so the shape satisfies ApplicationRenderContext, as in gmHandlerMenu.
  tabs?: undefined
}

export class PushStatusMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'TablematePushStatus',
    actions: {
      recheck: PushStatusMenu.recheck,
      sendTest: PushStatusMenu.sendTest
    },
    window: {
      title: 'Push notification status',
      icon: 'fas fa-bell'
    },
    position: { width: 560 }
  }
  static PARTS = {
    form: {
      template: 'modules/tablemate/templates/pushStatus.hbs'
    }
  }

  // Cached so re-rendering after a test push doesn't re-probe the relay; cleared
  // by the Check again button.
  #status: PushStatus | null = null

  async _prepareContext(): Promise<PushStatusContext> {
    if (!this.#status) this.#status = await collectPushStatus()
    return {
      ...this.#status,
      checks: this.#status.checks.map((check) => ({ ...check, icon: STATE_ICONS[check.state] }))
    }
  }

  static async recheck(this: PushStatusMenu) {
    this.#status = null
    await this.render()
  }

  static async sendTest(this: PushStatusMenu) {
    const result = await sendTestPush()
    if (result.ok) ui.notifications?.info(`Tabula Mensa: test notification sent. ${result.detail}`)
    else ui.notifications?.warn(`Tabula Mensa: test notification not sent. ${result.detail}`)
    // The send may have changed what the checks would say (a dead token gets
    // pruned, for instance), so drop the cache before redrawing.
    this.#status = null
    await this.render()
  }
}
