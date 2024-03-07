// import 'libs/hammer.min.js'

import { setupTouch } from './scripts/touchmate.mjs'
import { setupCharSheet } from './scripts/charsheet.mjs'

const MODNAME = 'module.tablemate'

Hooks.on('init', function () {
  const user = game.data.users.find((x) => x._id === game.userId)
  console.log('TABLEMATE initialized for user', user)

  if (user.name.match('Sheet')) {
    window.location = `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
  }
})

Hooks.on('ready', () => {
  console.log('TABLEMATE: READY TO ROLLS')
  const user = game.data.users.find((x) => x._id === game.userId)

  if (user.name === 'Observer') {
    setupTouch()
  }

  setupCharSheet()
})
