// TODO: have more robust way of detecting observer in iAmObserver method
const MODNAME = 'module.tablemate'

export function setupCharSheet() {
  announceSelf()

  game.socket.onAnyOutgoing((event, ...args) => {
    if (
      event === 'userActivity' ||
      event === 'template' ||
      event === 'manageFiles' ||
      (event.match('module.') && !event.match('module.tablemate'))
    )
      return
    console.log(`TM.SEND ${event}`, args)
  })

  game.socket.on('modifyDocument', (args) => console.log(args))
  game.socket.on(MODNAME, (args, ack, zoo) => {
    console.log('TM.RECV', args)
    switch (args.action) {
      case 'anybodyHome':
        announceSelf()
        break
      case 'requestCharacterDetails':
        if (iAmObserverOrFallbackGM()) updateCharacterDetails(args)
        break
      case 'rollCheck':
        if (iAmObserverOrFallbackGM()) rollCheck(args)
        break
      case 'castSpell':
        if (iAmObserverOrFallbackGM()) castSpell(args)
        break
      case 'makeStrike':
        if (iAmObserverOrFallbackGM()) makeStrike(args)
        break
      case 'rollInitiative':
        if (iAmObserverOrFallbackGM()) rollInitiative(args)
        break
      case 'rollConfirm':
        if (game.user._id === args.userId) rollConfirm(args)
        break
      case 'runMacro':
        if (iAmObserverOrFallbackGM()) runMacro(args)
        break
      default:
        console.log('event not caught', args.action, args)
    }
  })
}

// utility functions
function iAmFirstGM() {
  return (
    game.user.isGM &&
    !game.users
      .filter((user) => user.isGM && user.active)
      .some((other) => other._id < game.user._id)
  )
}
function iAmObserver() {
  return game.user.name === 'Observer'
}
function observerIsOnline() {
  return game.users.filter((user) => user.name === 'Observer' && user.active).length > 0
}
function iAmObserverOrFallbackGM() {
  return iAmObserver() || (!observerIsOnline() && iAmFirstGM())
}

// content functions
function announceSelf() {
  if (iAmFirstGM()) {
    game.socket.emit(MODNAME, {
      action: 'gmOnline'
    })
  }
}
function updateCharacterDetails(args) {
  const a = game.actors.find((x) => x._id === args.actorId)
  const info = {
    action: 'updateCharacterDetails',
    actorId: a._id,
    actor: a,
    system: a.system,
    feats: a.feats //.set('unorganized', a.feats.bonus)
    // items: a.items,
    // inventory: a.inventory
  }
  game.socket.emit(MODNAME, info)
}
function rollCheck(args) {
  //https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = game.actors.get(args.characterId, { strict: true })
  const modifiers = args.modifiers.map((m) => {
    return new game.pf2e.Modifier(m)
  })
  const params = { skipDialog: args.skipDialog, modifiers: modifiers }
  switch (args.checkType) {
    case 'skill':
      actor.skills[args.checkSubtype].check.roll(params)
      break
    case 'save':
      actor.saves[args.checkSubtype].check.roll(params)
      break
    case 'perception':
      actor.perception.check.roll(params)
      break
  }
  game.socket.emit(MODNAME, { action: 'acknowledged', uuid: args.uuid })
}
function castSpell(args) {
  const actor = game.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true })
  const spellLocation = actor.items.get(item.system.location.value)
  spellLocation.cast(item, { rank: args.rank, slotId: args.slotId })
  game.socket.emit(MODNAME, { action: 'acknowledged', uuid: args.uuid })
}
// function makeStrike(args) {
//   const actor = game.actors.get(args.characterId, { strict: true })
//   const strike = actor.system.actions.find((a) => a.slug === args.strikeSlug)
//   strike.variants[args.strikeVariant].roll()
// }
// function rollInitiative(args) {
//   const combatantId = game.combat.combatants.find((c) => c.actorId === args.characterId)?._id
//   console.log(combatantId)
//   if (combatantId) game.combat.rollInitiative([combatantId], { updateTurn: false })
// }
// function rollConfirm(args) {
//   if (args.roll) {
//     ui.windows?.[args.appId].resolve(true)
//     ui.windows[args.appId].isResolved = true
//   }
//   ui.windows?.[args.appId].close()
// }
// function runMacro(args) {
//   const actor = game.actors.get(args.characterId)
//   const tokenId = canvas.tokens.documentCollection.find((t) => t.actorId === args.characterId).id
//   const token = canvas.tokens.get(tokenId)
//   console.log('run macro using: ', token)
//   const controlled = token.control({ releaseOthers: true }) // it'd be nice to not release others, but need a way to ensure new token is "first"
//   console.log('now controlled', controlled)
//   console.log('macro', args.characterId, actor)
//   game.packs
//     .get(args.compendium)
//     .getDocument(args.macroId)
//     .then((m) => {
//       m.execute({ actors: actor })
//       //token.release()
//     })
// }

// roll management
// Hooks.on('renderCheckModifiersDialog', (application, html, data) => {
//   console.log('roll', application.appId)
//   game.socket.emit(MODNAME, {
//     action: 'rollReady',
//     characterId: application.context.actor._id,
//     userId: game.user._id,
//     appId: application.appId,
//     application: application
//   })
//   // application.context.substitutions.push({
//   //   label: 'Manual Roll',
//   //   required: true,
//   //   selected: true,
//   //   slug: 'manualroll',
//   //   value: 14
//   // })
//   // application.render()
// })
// Hooks.on('renderManualResolver', (application, html, data) => {
//   console.log('manual', application.appId)
//   console.log(application, html, data)
//   // html[0].setProperty('display', 'block', 'important')
//   ui.windows[application.appId]._element[0].style.setProperty('display', 'block', 'important')
// })
