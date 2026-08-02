import { setupListener } from './listener'
import { setupChatOriginDisplay } from './chatOriginDisplay'
import { setupReactionDisplay, setupReactionContextMenu } from './reactionDisplay'
import { setupChatImagePopout } from './chatImagePopout'
import { setupSpellCardTargeting } from './spellCardTargeting'
import { setupSettingsHeaders } from './settingsHeaders'
import { checkSystemCompat } from './systemCompat'
import { PlayerSelectMenu } from './playerSelectMenu'
import { GmHandlerMenu, GM_HANDLER_MENU_KEY } from './gmHandlerMenu'
import { PushStatusMenu, PUSH_STATUS_MENU_KEY } from './pushStatusMenu'
import type { UserSourcePF2e } from '@7h3laughingman/pf2e-types'
import { isSheetUser } from './utils/sheetUser'
import { logger } from '@/utils/utilities'

console.log('TM tablemate.mjs MODE:', import.meta.env.MODE, 'PROD:', import.meta.env.PROD)
logger.info('TM initializing...')

// Must run at init, not ready: core renders the sidebar before firing `ready`,
// and ChatLog builds its right-click menu once during that render. Registering
// any later misses the only time the hook fires. See reactionDisplay.ts.
Hooks.on('init', setupReactionContextMenu)

// Escape hatch from the redirect below: load the world with `?tablemate=off` and
// this tab stays in Foundry. Without it a sheet user has no way back into the
// Foundry UI — which is merely inconvenient for a player, but locks a GM out of
// their own world (including out of the User Select menu that would undo it).
// Remembered for the tab, because the redirect runs again on every reload and
// the URL that carried the flag is long gone by then.
const REDIRECT_OFF_KEY = 'tablemate.redirect.off'

function foundryRequested(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('tablemate') === 'off') {
      window.sessionStorage?.setItem(REDIRECT_OFF_KEY, '1')
      return true
    }
    return window.sessionStorage?.getItem(REDIRECT_OFF_KEY) === '1'
  } catch {
    // Storage can throw (private mode, blocked cookies). The query parameter
    // alone still works for this page load.
    return new URLSearchParams(window.location.search).get('tablemate') === 'off'
  }
}

Hooks.on('init', function () {
  const user = game.data.users.find((x: UserSourcePF2e) => x._id === game.userId)
  if (!isSheetUser(user)) return
  if (foundryRequested()) {
    logger.info('TM sheet user staying in Foundry (?tablemate=off)')
    return
  }
  logger.info('TM HERE', user?.character)
  const url = user?.character
    ? `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
    : `${window.location.origin}/modules/tablemate/index.html`
  window.location.assign(url)
})

Hooks.on('ready', () => {
  setupListener()
  setupChatOriginDisplay()
  setupReactionDisplay()
  setupChatImagePopout()
  setupSpellCardTargeting()
  setupSettingsHeaders()
  checkSystemCompat()

  logger.info('tablemate hello')
  game.settings.registerMenu('tablemate', 'playerSelectMenu', {
    name: 'User Select',
    label: 'Select Character Sheet users',
    hint: 'Select which users will load the alternate Character Sheet instead of the standard Foundry environment',
    type: PlayerSelectMenu as ConstructorOf<foundry.applications.api.ApplicationV2>,
    icon: 'fas fa-user',
    restricted: true
  })
  game.settings.registerMenu('tablemate', GM_HANDLER_MENU_KEY, {
    name: 'GM Handlers',
    label: 'Set GM handler priority',
    hint: 'Choose which GMs handle requests from Tabula, and in what order. By default any GM can handle them, whoever has the lowest user ID first.',
    type: GmHandlerMenu as ConstructorOf<foundry.applications.api.ApplicationV2>,
    icon: 'fas fa-user-shield',
    restricted: true
  })
  game.settings.registerMenu('tablemate', PUSH_STATUS_MENU_KEY, {
    name: 'Push notifications',
    label: 'Check push notification status',
    hint: 'See whether push notifications are reaching phones — is the world provisioned, is the relay answering, who has a device registered — and send yourself a test notification.',
    type: PushStatusMenu as ConstructorOf<foundry.applications.api.ApplicationV2>,
    icon: 'fas fa-bell',
    restricted: true
  })
})
