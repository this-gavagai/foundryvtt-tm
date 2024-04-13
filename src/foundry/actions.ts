const MODNAME = 'module.tablemate'
const source = typeof window.game === 'undefined' ? parent.game : window.game

export async function getCharacterDetails(args: any) {
  const actor = source.actors.find((x: any) => x._id === args.actorId)

  // add the damage formula into things
  const damages = actor.system.actions.map((action: any) => action.damage({ getFormula: true }))
  const criticals = actor.system.actions.map((action: any) => action.critical({ getFormula: true }))
  await Promise.all([...damages, ...criticals]).then((values) => {
    const damageValues = values.slice(0, values.length / 2)
    const criticalValues = values.slice(values.length / 2)
    damageValues.forEach((dmg, i) => {
      actor.system.actions[i].tmDamageFormula = { base: dmg, critical: criticalValues[i] }
    })
  })

  // compose sending data into object
  return {
    action: 'updateCharacterDetails',
    actorId: actor._id,
    actor: JSON.stringify(actor),
    system: JSON.stringify(actor.system),
    feats: JSON.stringify(actor.feats)
  }
}

export async function rollCheck(args: any) {
  //https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = source.actors.get(args.characterId, { strict: true })
  const modifiers = args.modifiers.map((m: any) => {
    return new source.pf2e.Modifier(m)
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
      roll = actor.system.actions[damageIndex][crit](params)
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
      const combatantId = source.combat.combatants.find((c: any) => c.actorId === args.characterId)
        ?._id
      if (combatantId) roll = actor.initiative.roll([combatantId], { updateTurn: false })
      break
  }
  const r = await roll
  if (r.hasOwnProperty('roll')) console.log('this one has a weird property') // trying to figure out where this is necessary; don't remember
  const { formula, result, total, dice } = r.hasOwnProperty('roll') ? r.roll : r
  return {
    action: 'acknowledged',
    uuid: args.uuid,
    roll: { formula, result, total, dice }
  }
}

export async function characterAction(args: any) {
  const actor = source.actors.get(args.characterId, { strict: true })
  const params = { ...args.options, actors: actor }
  let promise
  if (args.characterAction.match('legacy.')) {
    const actionKey = args.characterAction.replace('legacy.', '')
    promise = source.pf2e.actions[actionKey](params)
  } else {
    promise = source.pf2e.actions.get(args.characterAction).use(params)
  }
  const r = await promise
  const { formula, result, total, dice } = r[0].roll
  return {
    action: 'acknowledged',
    uuid: args.uuid,
    roll: { formula, result, total, dice }
  }
}

export async function foundryCastSpell(args: any) {
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true })
  const spellLocation = actor.items.get(item.system.location.value)

  // this is an ugly hack to deal with the pf2e-dailies dialog popup for staves casting
  if (
    source.modules.get('pf2e-dailies')?.active &&
    spellLocation?.system?.prepared.value === 'charge'
  )
    window.Hooks.once('renderDialog', (a: any, b: any, c: any) =>
      setTimeout(() => b[0].querySelectorAll('button')[1].click(), 100)
    )

  spellLocation.cast(item, { rank: args.rank, slotId: args.slotId })
  return { action: 'acknowledged', uuid: args.uuid }
  // game.socket.emit(MODNAME, { action: 'acknowledged', uuid: args.uuid })
}

export async function consumeItem(args: any) {
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.consumableId, { strict: true })
  item.consume()
  return { action: 'acknowledged', uuid: args.uuid }
  // game.socket.emit(MODNAME, { action: 'acknowledged', uuid: args.uuid })
}

export function testFunction() {
  console.log('Hi, this is a test')
}
