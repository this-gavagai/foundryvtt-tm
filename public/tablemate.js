// import { setupTouch } from './touchmate'
// setupTouch()
// TODO: have more robust way of detecting observer in isObserver method
// TODO: have more robust way of detecting sheet in 'init' hook
const MODNAME = 'module.tablemate'
Hooks.on('init', function () {
  const user = game.data.users.find((x) => x._id === game.userId)
  console.log('TABLEMATE init:', user)

  if (user.name.match('Sheet')) {
    window.location = `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
  }
})

Hooks.on('ready', function () {
  const user = game.data.users.find((x) => x._id === game.userId)
  console.log('TABLEMATE ready:', user)
  if (user.name === 'Observer') {
    setupTouchTweaks()
  }

  console.log('tablemate:', 'listener update')
  game.socket.onAnyOutgoing((event, ...args) => {
    if (event === 'userActivity' || (event.match('module.') && !event.match('module.tablemate')))
      return
    console.log(`SEND ${event}`, args)
  })

  game.socket.on(MODNAME, (args) => {
    console.log('RECV', args)
    switch (args.action) {
      case 'anybodyHome':
        announceSelf()
        break
      case 'requestCharacterDetails':
        if (isFirstGm()) sendCharacterDetails(args)
        break
      case 'rollCheck':
        if (isObserverOrTryGm()) rollCheck(args)
        break
      case 'castSpell':
        if (isObserverOrTryGm()) castSpell(args)
        break
      case 'makeStrike':
        if (isObserverOrTryGm()) makeStrike(args)
        break
      case 'rollInitiative':
        if (isObserverOrTryGm()) rollInitiative(args)
        break
      case 'rollConfirm':
        if (game.user._id === args.userId) rollConfirm(args)
        break
      case 'runMacro':
        if (isObserverOrTryGm()) runMacro(args)
        break
      default:
        console.log('event not caught', args.action, args)
    }
  })
  announceSelf()
})

// utility functions
function announceSelf() {
  if (isFirstGm()) {
    game.socket.emit(MODNAME, {
      action: 'gmOnline'
    })
  }
}
function isFirstGm() {
  return (
    game.user.isGM &&
    !game.users
      .filter((user) => user.isGM && user.active)
      .some((other) => other._id < game.user._id)
  )
}
function isObserver() {
  return game.user.name === 'Observer'
}
function isObserverOrTryGm() {
  return isObserver() || (!isObserverOnline() && isFirstGm())
}
function isObserverOnline() {
  return game.users.filter((user) => user.name === 'Observer' && user.active).length > 0
}

// content functions
function sendCharacterDetails(args) {
  const a = game.actors.find((x) => x._id === args.characterId)
  game.socket.emit(MODNAME, {
    action: 'sendCharacterDetails',
    actorId: a._id,
    actor: a,
    system: a.system,
    feats: a.feats.set('unorganized', a.feats.unorganized),
    inventory: a.inventory
  })
}
function rollCheck(args) {
  const actor = game.actors.get(args.characterId, { strict: true })
  switch (args.checkType) {
    case 'skill':
      actor.skills[args.checkSubtype].check.roll()
      break
  }
}
function castSpell(args) {
  const actor = game.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true })
  const spellLocation = actor.items.get(item.system.location.value)
  let a = spellLocation.cast(item, { slot: NaN, level: args.level })
  a.then((m) => console.log(m))
}
function makeStrike(args) {
  const actor = game.actors.get(args.characterId, { strict: true })
  const strike = actor.system.actions.find((a) => a.slug === args.strikeSlug)
  strike.variants[args.strikeVariant].roll()
}
function rollInitiative(args) {
  const combatantId = game.combat.combatants.find((c) => c.actorId === args.characterId)?._id
  console.log(combatantId)
  if (combatantId) game.combat.rollInitiative([combatantId], { updateTurn: false })
}
function rollConfirm(args) {
  if (args.roll) {
    ui.windows?.[args.appId].resolve(true)
    ui.windows[args.appId].isResolved = true
  }
  ui.windows?.[args.appId].close()
}
function runMacro(args) {
  const actor = game.actors.get(args.characterId)
  const tokenId = canvas.tokens.documentCollection.find((t) => t.actorId === args.characterId).id
  const token = canvas.tokens.get(tokenId)
  console.log('run macro using: ', token)
  const controlled = token.control({ releaseOthers: true }) // it'd be nice to not release others, but need a way to ensure new token is "first"
  console.log('now controlled', controlled)
  console.log('macro', args.characterId, actor)
  game.packs
    .get(args.compendium)
    .getDocument(args.macroId)
    .then((m) => {
      m.execute({ actors: actor })
      token.release()
    })
}

// roll management
Hooks.on('renderCheckModifiersDialog', (application, html, data) => {
  console.log('roll', application.appId)
  game.socket.emit(MODNAME, {
    action: 'rollReady',
    characterId: application.context.actor._id,
    userId: game.user._id,
    appId: application.appId,
    application: application
  })
  // application.context.substitutions.push({
  //   label: 'Manual Roll',
  //   required: true,
  //   selected: true,
  //   slug: 'manualroll',
  //   value: 14
  // })
  // application.render()
})
// Hooks.on('renderManualResolver', (application, html, data) => {
//   console.log('manual', application.appId)
//   console.log(application, html, data)
//   // html[0].setProperty('display', 'block', 'important')
//   ui.windows[application.appId]._element[0].style.setProperty('display', 'block', 'important')
// })

// touch tweaks
function setupTouchTweaks() {
  console.log('tablemate: touch tweaks')
  const ZOOM_SPEED = 0.5
  const PAN_SPEED = 5
  const SMOOTH_LENGTH = 30
  const screen = document.querySelector('canvas#board')

  const hammer = new Hammer(screen)
  const pinch = hammer.get('pinch').set({ enable: true, threshold: 0 })
  const pan = hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL, pointers: 2, threshold: 0 })
  pinch.recognizeWith(pan)

  hammer.on('pinchstart', pinchStart)
  hammer.on('pinchend', pinchEnd)
  hammer.on('pan', panHandler)
  hammer.on('pinch', pinchHandler)

  // const reload = new Hammer.Press({ pointers: 4 })
  // reload.on(() => {
  //   location.reload()
  // })
  // hammer.add(reload)

  let base_scale = 1
  let scale_series = new Array(SMOOTH_LENGTH).fill(1)
  function getScale(ev) {
    base_scale = canvas.stage.scale.x
  }
  function pinchStart(ev) {
    console.log('pinch start')
    getScale(ev)
    // pinchStarted = true
  }
  function pinchEnd(ev) {
    console.log('pinch end')
    scale_series = new Array(SMOOTH_LENGTH).fill(1)
    // pinchStarted = false
  }

  function pinchHandler(ev) {
    canvas.controls.select.active = false
    scale_series.push(ev.scale)
    const smoothed_scale = scale_series
      .slice(SMOOTH_LENGTH * -1)
      .reduce((acc, c, i, a) => acc + c / a.length, 0)
    console.log(ev.scale, smoothed_scale)
    canvas.animatePan({
      scale: base_scale * Math.pow(smoothed_scale, ZOOM_SPEED),
      duration: 50
    })
  }
  function panHandler(ev) {
    //console.log("pan", ev.velocityX, ev.velocityY)
    canvas.controls.select.active = false
    // canvas.animatePan({
    canvas.pan({
      x: canvas.stage.pivot.x - (ev.velocityX * PAN_SPEED) / canvas.stage.scale.x,
      y: canvas.stage.pivot.y - (ev.velocityY * PAN_SPEED) / canvas.stage.scale.x
      // duration: 50
    })
  }

  canvas.tokens.addEventListener('pointerup', (e) => {
    console.log(e)
    if (e.pointerType === 'mouse') return
    canvas.tokens.children.forEach((c) => {
      c.children.forEach((t) => {
        try {
          if (t.interactionState) t.dispatchEvent(e)
        } catch (err) {
          console.log(e)
          console.log(err)
        }
      })
    })
  })
}
