import { setupTouch } from './touchmate'
import { setupListener } from './listener'
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

declare const Hooks: any
declare const game: any
declare const canvas: any
declare const foundry: any

console.log('tablemate initializing...')

Hooks.on('init', function () {
  const user = game.data.users.find((x: any) => x._id === game.userId)
  if (user.flags?.['tablemate']?.['character_sheet'] === 'root') {
    window.location.assign(
      `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
    )
  }
})

Hooks.on('setup', function () {
  // this is legacy code, from back when the app opened in a frame.
  const user = game.data.users.find((x: any) => x._id === game.userId)
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
  const user = game.data.users.find((x: any) => x._id === game.userId)
  if (user.flags?.['tablemate']?.['character_sheet'] === 'frame') {
    if (!game.audio.locked) game.audio.context?.stop()
  }
  if (user.flags?.['tablemate']?.['shared_display']) {
    setupTouch()
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
    const users = game.users.filter((u: any) => !u.isGM)
    users.forEach((s: any) => {
      s.sheeted = s.getFlag('tablemate', 'character_sheet') === 'root'
    })
    const buttons = [
      { type: 'button', action: 'close', label: 'Close' }
      // { type: "reset", action: "reset", icon: "fa-solid fa-undo", label: "SETTINGS.Reset" },
    ]
    return { users, buttons }
  }
  static async updateUserFlags(event: any, form: any, formData: any) {
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

/////////////////////
// settings config //
/////////////////////

// class MySubmenuApplicationClass extends FormApplication {
//   // lots of other things...
//   // getData() {
//   //   return game.settings.get('myModuleName', 'myComplexSettingName')
//   // }
//   // _updateObject(event, formData) {
//   //   const data = expandObject(formData)
//   //   // game.settings.set('myModuleName', 'myComplexSettingName', data)
//   // }
// }

// TODO: find a better way to do this, or at least update for app v2
// function newElement(tag: string, properties: any = {}) {
//   return Object.assign(document.createElement(tag), properties)
// }
// function addCharSheetFields(app: any, html: any, data: any) {
//   // sheet selector
//   const sheetSelect = newElement('div', { className: 'form-group' })
//   const sheetLabel = newElement('label', { textContent: 'Character Sheet' })
//   const sheetFields = newElement('div', { className: 'form-fields' })
//   const sheetNote = newElement('p', {
//     className: 'notes',
//     innerText: 'Tablemate character sheet display mode'
//   })
//   const selector = newElement('select')
//   const sel_standard = newElement('option', { value: '', innerText: 'Foundry Default' })
//   const sel_embedded = newElement('option', { value: 'frame', innerText: 'Tablemate (Embedded)' })
//   const sel_external = newElement('option', { value: 'root', innerText: 'Tablemate (External)' })

//   sheetSelect.append(sheetLabel, sheetFields, sheetNote)
//   sheetFields.append(selector)
//   selector.append(sel_standard, sel_embedded, sel_external)

//   // shared display toggle
//   const displayToggle = newElement('div', { className: 'form-group' })
//   const displayLabel = newElement('label', { textContent: 'Shared Display?' })
//   const displayFields = newElement('div', { className: 'form-fields' })
//   const displayNote = newElement('p', {
//     className: 'notes',
//     innerText: 'Shared Display for Targetting Assistance and Proxying'
//   })
//   const toggle = newElement('input', { type: 'checkbox' })

//   displayToggle.append(displayLabel, displayFields, displayNote)
//   displayFields.append(toggle)

//   // append to form
//   const userForm = html[0].querySelector('form')
//   userForm.prepend(sheetSelect, displayToggle)
//   app._onChangeTab()

//   selector.value = data.user.getFlag('tablemate', 'character_sheet') ?? ''
//   toggle.checked = data.user.getFlag('tablemate', 'shared_display') ? true : false
//   userForm.addEventListener(
//     'submit',
//     () => {
//       data.user.setFlag('tablemate', 'character_sheet', selector.value)
//       data.user.setFlag('tablemate', 'shared_display', toggle.checked)
//     },
//     false
//   )
// }
