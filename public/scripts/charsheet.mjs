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

  // game.socket.on('modifyDocument', (args) => console.log(args))
  game.socket.on(MODNAME, (args, ack, zoo) => {
    console.log('TM.RECV', args)
    switch (args.action) {
      case 'anybodyHome':
        announceSelf()
        break
      case 'requestCharacterDetails':
        if (iAmObserverOrFallbackGM()) updateCharacterDetails(args)
        break
      case 'updateCharacterDetails':
        break
      case 'rollCheck':
        if (iAmObserverOrFallbackGM()) rollCheck(args)
        break
      case 'castSpell':
        if (iAmObserverOrFallbackGM()) castSpell(args)
        break
      case 'characterAction':
        if (iAmObserverOrFallbackGM()) characterAction(args)
        break
      case 'consumeItem':
        if (iAmObserverOrFallbackGM()) consumeItem(args)
        break
      // case 'rollConfirm':
      //   if (game.user._id === args.userId) rollConfirm(args)
      //   break
      // case 'runMacro':
      //   if (iAmObserverOrFallbackGM()) runMacro(args)
      //   break
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
  return game.user.getFlag('tablemate', 'shared_display')
}
function observerIsOnline() {
  return (
    game.users.filter((user) => user.flags?.['tablemate']?.['shared_display'] && user.active)
      .length > 0
  )
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

async function updateCharacterDetails(args) {
  const actor = game.actors.find((x) => x._id === args.actorId)

  // add the damage formula into things
  const damages = actor.system.actions.map((action) => action.damage({ getFormula: true }))
  const criticals = actor.system.actions.map((action) => action.critical({ getFormula: true }))
  await Promise.all([...damages, ...criticals]).then((values) => {
    const damageValues = values.slice(0, values.length / 2)
    const criticalValues = values.slice(values.length / 2)
    damageValues.forEach((dmg, i) => {
      actor.system.actions[i].tmDamageFormula = { base: dmg, critical: criticalValues[i] }
    })
  })

  // compose sending data into object
  const info = {
    action: 'updateCharacterDetails',
    actorId: actor._id,
    actor: actor,
    system: actor.system,
    feats: actor.feats
  }
  game.socket.emit(MODNAME, info)
}

// character actions
function rollCheck(args) {
  //https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = game.actors.get(args.characterId, { strict: true })
  const modifiers = args.modifiers.map((m) => {
    return new game.pf2e.Modifier(m)
  })
  const params = { skipDialog: args.skipDialog, modifiers: modifiers }
  let roll
  switch (args.checkType) {
    case 'strike':
      const [actionIndex, variant] = args.checkSubtype.split(',')
      roll = actor.system.actions[actionIndex].variants[variant].roll(params)
      break
    case 'damage':
      const [damageIndex, crit] = args.checkSubtype.split(',')
      roll = actor.system.actions[damageIndex][crit ? 'damage' : 'critical'](params)
      break
    case 'skill':
      roll = actor.skills[args.checkSubtype].check.roll(params)
      break
    case 'save':
      roll = actor.saves[args.checkSubtype].check.roll(params)
      break
    case 'perception':
      roll = actor.perception.check.roll(params)
      break
    case 'initiative':
      const combatantId = game.combat.combatants.find((c) => c.actorId === args.characterId)?._id
      if (combatantId) roll = actor.initiative.roll([combatantId], { updateTurn: false })
      break
  }
  roll?.then((r) => {
    if (r.hasOwnProperty('roll')) r = r.roll
    game.socket.emit(MODNAME, {
      action: 'acknowledged',
      uuid: args.uuid,
      roll: { formula: r.formula, result: r.result, total: r.total, dice: r.dice }
    })
  })
}

function characterAction(args) {
  const actor = game.actors.get(args.characterId, { strict: true })
  const params = { ...args.options, actors: actor }
  let promise
  if (args.characterAction.match('legacy.')) {
    const actionKey = args.characterAction.replace('legacy.', '')
    promise = game.pf2e.actions[actionKey](params)
  } else {
    promise = game.pf2e.actions.get(args.characterAction).use(params)
  }
  promise.then((r) => {
    console.log(r)
    game.socket.emit(MODNAME, {
      action: 'acknowledged',
      uuid: args.uuid,
      roll: {
        formula: r[0].roll.formula,
        result: r[0].roll.result,
        total: r[0].roll.total,
        dice: r[0].roll.dice
      }
    })
  })
}

function castSpell(args) {
  const actor = game.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true })
  const spellLocation = actor.items.get(item.system.location.value)

  // this is an ugly hack to deal with the pf2e-dailies dialog popup
  if (
    game.modules.get('pf2e-dailies')?.active &&
    spellLocation?.system?.prepared.value === 'charge'
  )
    Hooks.once('renderDialog', (a, b, c) =>
      setTimeout(() => b[0].querySelectorAll('button')[1].click(), 100)
    )

  spellLocation.cast(item, { rank: args.rank, slotId: args.slotId })
  game.socket.emit(MODNAME, { action: 'acknowledged', uuid: args.uuid })
}

function consumeItem(args) {
  const actor = game.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.consumableId, { strict: true })
  item.consume()
  game.socket.emit(MODNAME, { action: 'acknowledged', uuid: args.uuid })
}

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
//   const controlled = token.control({ releaseOthers: true })
// it'd be nice to not release others, but need a way to ensure new token is "first"
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
