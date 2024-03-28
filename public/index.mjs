// TODO: allow setting of "external_app" and "shared_display" flags in-game

import { setupTouch } from './scripts/touchmate.mjs'
import { setupCharSheet } from './scripts/charsheet.mjs'

const MODNAME = 'module.tablemate'

Hooks.on('setup', function () {
  const user = game.data.users.find((x) => x._id === game.userId)
  console.log('TABLEMATE initialized for user', user)

  console.log('TABLEMATE:', user.name)
  if (user.flags?.['tablemate']?.['external_app']) {
    game.settings.set('core', 'noCanvas', true)

    const app = document.createElement('iframe')
    app.width = '100%'
    app.src = `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
    document.querySelector('body').appendChild(app)

    const styles = document.createElement('link')
    styles.setAttribute('rel', 'stylesheet')
    styles.setAttribute('href', '/modules/tablemate/tablemate.css')
    document.head.appendChild(styles)

    // window.location = `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
  }
})

// Hooks.on('ready', function () {
//   const user = game.data.users.find((x) => x._id === game.userId)
//   if (user.flags?.['tablemate']?.['external_app']) {
//     document.querySelector('#pause').style.display = 'none'
//     document.querySelector('#notifications').style.display = 'none'
//   }
// })

Hooks.on('ready', () => {
  const user = game.data.users.find((x) => x._id === game.userId)
  if (user.flags?.['tablemate']?.['shared_display']) {
    setupTouch()
  }
  setupCharSheet()
})
