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
    // TODO: (bug) turn off dice roll preview settings programmatically; character creation hangs otherwise
    game.settings.set('core', 'noCanvas', true)
    //user.flags.settings.pf2e.settings.showCheckDialogs = false
    //user.flags.settings.pf2e.settings.showDamageDialogs = false

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
  if (user.flags?.['tablemate']?.['shared_display']) {
    setupTouch()
  }
  setupListener()

  Hooks.on('renderUserConfigPF2e', (app: any, html: any, data: any) => {
    const control = document.createDocumentFragment()
    const wrapper = document.createElement('div')
    wrapper.className = 'form-group'
    const label = document.createElement('label')
    label.textContent = 'Character Sheet'
    wrapper.append(label)
    const fields = document.createElement('div')
    fields.className = 'form-fields'
    wrapper.append(fields)
    const selector = document.createElement('select')
    fields.append(selector)
    const sel_standard = document.createElement('option')
    const sel_embedded = document.createElement('option')
    const sel_external = document.createElement('option')
    sel_standard.innerText = 'Foundry Default'
    sel_embedded.innerText = 'Tablemate (Embedded)'
    sel_external.innerText = 'Tablemate (External)'
    sel_standard.value = ''
    sel_embedded.value = 'frame'
    sel_external.value = 'root'
    selector.append(sel_standard)
    selector.append(sel_embedded)
    selector.append(sel_external)

    control.appendChild(wrapper)
    const userForm = html[0].querySelector('form')
    userForm.prepend(control)
    app._onChangeTab()

    selector.value = data.user.getFlag('tablemate', 'character_sheet') ?? ''
    userForm.addEventListener(
      'submit',
      () => data.user.setFlag('tablemate', 'character_sheet', selector.value),
      false
    )
  })
})
