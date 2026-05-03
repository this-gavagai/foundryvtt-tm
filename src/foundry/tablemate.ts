import { setupListener } from './listener'
import type { UserPF2e, UserSourcePF2e } from '@7h3laughingman/pf2e-types'
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

declare interface Form {
  [key: string]: object
}
declare interface FormData {
  object: { [key: string]: unknown }
}
declare interface SheetableUser extends UserPF2e {
  sheeted: boolean
}
declare interface PlayerSelectContext {
  users: SheetableUser[]
  buttons: { type: string; action: string; label: string }[]
  tabs?: undefined
}

console.log('TM initializing...')

Hooks.on('init', function () {
  const user = game.data.users.find((x: UserSourcePF2e) => x._id === game.userId)
  if (user?.flags?.['tablemate']?.['character_sheet'] === 'root') {
    console.log('TM HERE', user?.character)
    const url = user?.character
      ? `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
      : `${window.location.origin}/modules/tablemate/index.html`
    window.location.assign(url)
  }
})

Hooks.on('ready', () => {
  setupListener()

  console.log('tablemate hello')
  game.settings.registerMenu('tablemate', 'playerSelectMenu', {
    name: 'User Select',
    label: 'Select Character Sheet users',
    hint: 'Select which users will load the alternate Character Sheet instead of the standard Foundry environment',
    type: PlayerSelectMenu as unknown as ConstructorOf<foundry.applications.api.ApplicationV2>,
    icon: 'fas fa-user',
    restricted: true
  })
})

class PlayerSelectMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'PlayerSelectMenu',
    actions: {},
    window: {
      title: 'Character Sheet mode',
      icon: 'fas fa-user'
    },
    tag: 'form',
    form: {
      handler: PlayerSelectMenu.updateUserFlags,
      submitOnChange: true,
      closeOnSubmit: false
    }
  }
  static PARTS = {
    form: {
      template: 'modules/tablemate/templates/userSelect.hbs'
    },
    footer: {
      template: 'templates/generic/form-footer.hbs'
    }
  }
  async _prepareContext(): Promise<PlayerSelectContext> {
    const users = game.users.filter((u: UserPF2e) => !u.isGM) as SheetableUser[]
    users.forEach((s) => {
      s.sheeted = s.getFlag('tablemate', 'character_sheet') === 'root'
    })
    const buttons = [{ type: 'button', action: 'close', label: 'Close' }]
    return { users, buttons }
  }

  static async updateUserFlags(event: Event, form: Form, formData: FormData) {
    // Do things with the returned FormData
    for (const id in formData.object) {
      const usr = game.users.get(id)
      if (formData.object[id]) {
        if (usr?.getFlag('tablemate', 'character_sheet') !== 'root')
          usr?.setFlag('tablemate', 'character_sheet', 'root')
      } else {
        if (usr?.getFlag('tablemate', 'character_sheet'))
          usr?.unsetFlag('tablemate', 'character_sheet')
      }
    }
  }
}
