import { setupListener } from './listener'
import type { Hooks, Game, Canvas, Foundry, User } from '@/types/foundry-types'
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

declare const Hooks: Hooks
declare const game: Game
declare const canvas: Canvas
declare const foundry: Foundry

declare interface Form {
  [key: string]: object
}
declare interface FormData {
  object: { [key: string]: object }
}
declare interface SheetableUser extends User {
  sheeted: boolean
}

console.log('tablemate initializing...')

Hooks.on('init', function () {
  const user = game.data.users.find((x: User) => x._id === game.userId)
  if (user.flags?.['tablemate']?.['character_sheet'] === 'root') {
    window.location.assign(
      `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
    )
  }
})

Hooks.on('setup', function () {
  // this is legacy code, from back when the app opened in a frame.
  const user = game.data.users.find((x: User) => x._id === game.userId)
  if (user.flags?.['tablemate']?.['character_sheet'] === 'frame') {
    console.log('TABLEMATE: Loading in frame')
    user.flags.pf2e.settings.showCheckDialogs = false
    user.flags.pf2e.settings.showDamageDialogs = false

    Hooks.once('canvasReady', function () {
      console.log('tablemate canvas state', canvas.ready)
      canvas.app.stop()
    })

    const app = document.createElement('iframe')
    app.width = '100%'
    app.src = `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
    document.querySelector('body')?.appendChild(app)

    const styles = document.createElement('link')
    styles.setAttribute('rel', 'stylesheet')
    styles.setAttribute('href', '/modules/tablemate/tablemate.css')
    document.head.appendChild(styles)
  }
})

Hooks.on('ready', () => {
  const user = game.data.users.find((x: User) => x._id === game.userId)
  if (user.flags?.['tablemate']?.['character_sheet'] === 'frame') {
    if (!game.audio.locked) game.audio.context?.stop()
  }
  // Hooks.on('renderUserConfigPF2e', (app: any, html: any, data: any) => {
  //   addCharSheetFields(app, html, data)
  // })
  setupListener()

  console.log('tablemate hello')
  game.settings.registerMenu('tablemate', 'playerSelectMenu', {
    name: 'User Select',
    label: 'Select Character Sheet users',
    hint: 'Select which users will load the alternate Character Sheet instead of the standard Foundry environment',
    type: PlayerSelectMenu,
    icon: 'fas fa-user',
    restricted: true
  })
})

class PlayerSelectMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'PlayerSelectMenu',
    actions: {
      myAction: PlayerSelectMenu.updateUserFlags
    },
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
  _prepareContext() {
    const users = game.users.filter((u: User) => !u.isGM)
    users.forEach((s: SheetableUser) => {
      s.sheeted = s.getFlag('tablemate', 'character_sheet') === 'root'
    })
    const buttons = [
      { type: 'button', action: 'close', label: 'Close' }
      // { type: "reset", action: "reset", icon: "fa-solid fa-undo", label: "SETTINGS.Reset" },
    ]
    return { users, buttons }
  }
  static async updateUserFlags(event: Event, form: Form, formData: FormData) {
    // Do things with the returned FormData
    for (const id in formData.object) {
      const usr = game.users.get(id)
      if (formData.object[id]) {
        if (usr.getFlag('tablemate', 'character_sheet') !== 'root')
          usr.setFlag('tablemate', 'character_sheet', 'root')
      } else {
        if (usr.getFlag('tablemate', 'character_sheet'))
          usr.unsetFlag('tablemate', 'character_sheet')
      }
    }
  }
}
