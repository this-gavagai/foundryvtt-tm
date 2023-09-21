Hooks.on('init', function () {
  const user = game.data.users.find((x) => x._id === game.userId)
  console.log('TABLEMATE init:', user)

  if (user.name.match('Sheet')) {
    window.location = `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
  }
  //   window.history.pushState(null, '', '/game')
})

Hooks.on('ready', function () {
  const MODNAME = 'module.tablemate'

  console.log('listener update')

  game.socket.listenersAnyOutgoing().forEach((l) => game.socket.offAnyOutgoing(l))
  game.socket.onAnyOutgoing((event, ...args) => {
    if (event !== 'userActivity') console.log(`SEND ${event}`, args)
  })

  game.socket.removeAllListeners(MODNAME)
  game.socket.on(MODNAME, (args) => {
    console.log('RECV', args)
    if (!game.user.isGM) return
    if (
      game.users
        .filter((user) => user.isGM && user.isActive)
        .some((other) => other.data._id < game.user.data._id)
    )
      return

    switch (args.action) {
      case 'requestCharacterDetails':
        sendCharacterDetails(args)
        break
      case 'castSpell':
        castSpell(args)
        break
      default:
        console.log('event not caught')
    }
  })
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
  function castSpell(args) {
    const actor = game.actors.get(args.characterId, { strict: true })
    const item = actor.items.get(args.id, { strict: true })
    const spellLocation = actor.items.get(item.system.location.value)
    let a = spellLocation.cast(item, { slot: NaN, level: args.level })
    a.then((m) => console.log(m))
  }
  function sendSessionId(args) {
    sid = ''
    for (let cookie of document.cookie.split('; ')) {
      const [name, value] = cookie.split('=')
      if (name === 'session') {
        sid = decodeURIComponent(value)
        break
      }
    }
    game.socket.emit(MODNAME, {
      action: 'sendSessionId',
      sessionId: sid
    })
  }
})
