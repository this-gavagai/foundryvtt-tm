import { setupTouch } from './touchmate'
import { setupListener } from './listener'

declare const Hooks: any
declare const game: any
const MODNAME = 'module.tablemate'

console.log('tablemate!')

Hooks.on('init', function () {
  const user = game.data.users.find((x: any) => x._id === game.userId)
  if (user.flags?.['tablemate']?.['character_sheet'] === 'root') {
    window.location.assign(
      `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
    )
  }
})

Hooks.on('setup', function () {
  const user = game.data.users.find((x: any) => x._id === game.userId)
  if (user.flags?.['tablemate']?.['character_sheet'] === 'frame') {
    // TODO: (bug) turn off dice roll preview settings programmatically; character loading hangs otherwise
    game.settings.set('core', 'noCanvas', true)
    user.flags.pf2e.settings.showCheckDialogs = false
    user.flags.pf2e.settings.showDamageDialogs = false

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
  Hooks.on('renderUserConfigPF2e', (app: any, html: any, data: any) => {
    addCharSheetFields(app, html, data)
  })
  setupListener()
})

function newElement(tag: string, properties: any = {}) {
  return Object.assign(document.createElement(tag), properties)
}
/////////
function addCharSheetFields(app: any, html: any, data: any) {
  // sheet selector
  const sheetSelect = newElement('div', { className: 'form-group' })
  const sheetLabel = newElement('label', { textContent: 'Character Sheet' })
  const sheetFields = newElement('div', { className: 'form-fields' })
  const sheetNote = newElement('p', {
    className: 'notes',
    innerText: 'Tablemate character sheet display mode'
  })
  const selector = newElement('select')
  const sel_standard = newElement('option', { value: '', innerText: 'Foundry Default' })
  const sel_embedded = newElement('option', { value: 'frame', innerText: 'Tablemate (Embedded)' })
  const sel_external = newElement('option', { value: 'root', innerText: 'Tablemate (External)' })

  sheetSelect.append(sheetLabel, sheetFields, sheetNote)
  sheetFields.append(selector)
  selector.append(sel_standard, sel_embedded, sel_external)

  // shared display toggle
  const displayToggle = newElement('div', { className: 'form-group' })
  const displayLabel = newElement('label', { textContent: 'Shared Display?' })
  const displayFields = newElement('div', { className: 'form-fields' })
  const displayNote = newElement('p', {
    className: 'notes',
    innerText: 'Shared Display for Targetting Assistance and Proxying'
  })
  const toggle = newElement('input', { type: 'checkbox' })

  displayToggle.append(displayLabel, displayFields, displayNote)
  displayFields.append(toggle)

  // append to form
  const userForm = html[0].querySelector('form')
  userForm.prepend(sheetSelect, displayToggle)
  app._onChangeTab()

  selector.value = data.user.getFlag('tablemate', 'character_sheet') ?? ''
  toggle.checked = data.user.getFlag('tablemate', 'shared_display') ? true : false
  userForm.addEventListener(
    'submit',
    () => {
      data.user.setFlag('tablemate', 'character_sheet', selector.value)
      data.user.setFlag('tablemate', 'shared_display', toggle.checked)
    },
    false
  )
}
