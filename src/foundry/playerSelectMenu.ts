// Settings-menu ApplicationV2 for choosing which users load the Tablemate
// character sheet, and which login user each sheet "belongs to" (so whispers
// addressed to the human surface in that player's Tablemate sheet).

import type { UserPF2e } from '@7h3laughingman/pf2e-types'
import type FormDataExtended from '@7h3laughingman/foundry-types/client/applications/ux/form-data-extended.mjs'

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

declare interface BelongsToOption {
  id: string
  name: string
  selected: boolean
}
declare interface SheetableUser extends UserPF2e {
  sheeted: boolean
  belongsTo: string
  belongsToOptions: BelongsToOption[]
}
declare interface PlayerSelectContext {
  users: SheetableUser[]
  buttons: { type: string; action: string; label: string }[]
  tabs?: undefined
}

export class PlayerSelectMenu extends HandlebarsApplicationMixin(ApplicationV2) {
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
    // "Belongs To" links a sheet user (e.g. "Bob's Sheet") to the human's
    // primary login user (e.g. "Bob"), so whispers addressed to the human
    // surface in that player's Tablemate sheet. Offer every other user as a
    // candidate owner; a sheet should not belong to itself.
    users.forEach((s) => {
      s.sheeted = s.getFlag('tablemate', 'character_sheet') === 'root'
      const belongsTo = s.getFlag('tablemate', 'belongsTo')
      s.belongsTo = typeof belongsTo === 'string' ? belongsTo : ''
      s.belongsToOptions = game.users
        .filter((u: UserPF2e) => u.id !== s.id)
        .map((u: UserPF2e) => ({
          id: u.id,
          name: u.name,
          selected: u.id === s.belongsTo
        }))
    })
    const buttons = [{ type: 'button', action: 'close', label: 'Close' }]
    return { users, buttons }
  }

  static async updateUserFlags(event: Event, form: HTMLFormElement, formData: FormDataExtended) {
    // FormDataExtended keeps dotted field names flat (e.g. "sheeted.<id>"); it
    // does not nest them. Split each key into its field prefix and user id so we
    // can group the checkbox and select values by user.
    const sheeted: Record<string, unknown> = {}
    const belongsTo: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(formData.object)) {
      const dot = key.indexOf('.')
      if (dot < 0) continue
      const field = key.slice(0, dot)
      const id = key.slice(dot + 1)
      if (field === 'sheeted') sheeted[id] = value
      else if (field === 'belongsTo') belongsTo[id] = value
    }

    for (const usr of game.users.filter((u: UserPF2e) => !u.isGM)) {
      const id = usr.id

      if (sheeted[id]) {
        if (usr.getFlag('tablemate', 'character_sheet') !== 'root')
          await usr.setFlag('tablemate', 'character_sheet', 'root')
      } else {
        if (usr.getFlag('tablemate', 'character_sheet'))
          await usr.unsetFlag('tablemate', 'character_sheet')
      }

      const owner = belongsTo[id]
      if (typeof owner === 'string' && owner) {
        if (usr.getFlag('tablemate', 'belongsTo') !== owner)
          await usr.setFlag('tablemate', 'belongsTo', owner)
      } else {
        if (usr.getFlag('tablemate', 'belongsTo')) await usr.unsetFlag('tablemate', 'belongsTo')
      }
    }
  }
}
