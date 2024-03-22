// TODO: allow setting of "external_app" and "shared_display" flags externally

import { setupTouch } from './scripts/touchmate.mjs'
import { setupCharSheet } from './scripts/charsheet.mjs'

const MODNAME = 'module.tablemate'

Hooks.on('init', function () {
  const user = game.data.users.find((x) => x._id === game.userId)
  console.log('TABLEMATE initialized for user', user)

  console.log('TABLEMATE:', user.name)
  if (user.flags?.['tablemate']?.['external_app']) {
    window.location = `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
  }
})

Hooks.on('ready', () => {
  console.log('TABLEMATE: READY TO ROLLS')
  const user = game.data.users.find((x) => x._id === game.userId)

  if (user.flags?.['tablemate']?.['shared_display']) {
    setupTouch()
  }

  setupCharSheet()
})
