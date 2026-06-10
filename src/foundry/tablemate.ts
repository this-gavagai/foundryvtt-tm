import { setupListener } from './listener'
import { setupChatOriginDisplay } from './chatOriginDisplay'
import { setupSpellCardTargeting } from './spellCardTargeting'
import { PlayerSelectMenu } from './playerSelectMenu'
import type { UserSourcePF2e } from '@7h3laughingman/pf2e-types'
import { logger } from '@/utils/utilities'

console.log('TM tablemate.mjs MODE:', import.meta.env.MODE, 'PROD:', import.meta.env.PROD)
logger.info('TM initializing...')

Hooks.on('init', function () {
  const user = game.data.users.find((x: UserSourcePF2e) => x._id === game.userId)
  if (user?.flags?.['tablemate']?.['character_sheet'] === 'root') {
    logger.info('TM HERE', user?.character)
    const url = user?.character
      ? `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
      : `${window.location.origin}/modules/tablemate/index.html`
    window.location.assign(url)
  }
})

Hooks.on('ready', () => {
  setupListener()
  setupChatOriginDisplay()
  setupSpellCardTargeting()

  logger.info('tablemate hello')
  game.settings.registerMenu('tablemate', 'playerSelectMenu', {
    name: 'User Select',
    label: 'Select Character Sheet users',
    hint: 'Select which users will load the alternate Character Sheet instead of the standard Foundry environment',
    type: PlayerSelectMenu as ConstructorOf<foundry.applications.api.ApplicationV2>,
    icon: 'fas fa-user',
    restricted: true
  })
})
