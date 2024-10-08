import type {
  Actor,
  Action,
  CheckArgs,
  ActionArgs,
  Modifier,
  Combatant,
  CastArgs,
  ConsumeArgs,
  Game
} from '@/types/pf2e-types'

export async function getCharacterDetails(args: { actorId: string }) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const fakeEvent = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: source.user.settings['showDamageDialogs']
  }
  const actor = source.actors.find((x: Actor) => x._id === args.actorId)

  // add the damage formula into things; wish there was a better way
  const damages = actor.system.actions.map((action: Action) => action.damage({ getFormula: true }))
  const crits = actor.system.actions.map((action: Action) => action.critical({ getFormula: true }))
  // TODO: damage modifiers aren't viable right now because the skipDialog is getting ignored
  // const modifiers: any[] = []
  const modifiers = actor.system.actions.map((action: Action) =>
    action.damage({ createMessage: false, skipDialog: true, event: fakeEvent })
  )

  // await Promise.all([...damages, ...crits]).then((values) => {
  await Promise.all([...damages, ...crits, ...modifiers]).then((values) => {
    const damageValues = values.slice(0, values.length / 3)
    const criticalValues = values.slice(values.length / 3, 2 * (values.length / 3))
    const modifiers = values.slice(2 * (values.length / 3), 3 * (values.length / 3))
    damageValues.forEach((dmg, i) => {
      actor.system.actions[i].tmDamageFormula = {
        base: dmg,
        critical: criticalValues[i],
        _modifiers: modifiers[i]?.options?.damage?.modifiers
      }
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

export async function foundryRollCheck(args: CheckArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const fakeEvent = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: source.user.settings['showDamageDialogs']
  }
  console.log('tablemate', args)
  //https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = source.actors.get(args.characterId, { strict: true })
  const modifiers = args.modifiers.map((m: Modifier) => {
    return new source.pf2e.Modifier(m)
  })
  const targetTokenDoc =
    args.targets?.map((t: string) => source.scenes.active.tokens.get(t))[0] ?? null
  console.log('token doc', targetTokenDoc)
  const params = {
    modifiers: modifiers,
    // target: targetTokenDoc ? { document: targetTokenDoc } : null
    target: targetTokenDoc?.object,
    // target: targetTokenDoc
    // target: targetTokenDoc?.actor
    // skipDialog: args.skipDialog,
    skipDialog: true,
    event: fakeEvent
    // context: { target: args.options?.targets },
  }
  console.log('params', params)
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
      params.target = null // TODO: Figure out why this is necessary?
      roll = actor.skills[args.checkSubtype].check.roll(params)
      break
    case 'save':
      roll = actor.saves[args.checkSubtype].check.roll(params)
      break
    case 'perception':
      params.target = null // TODO: Figure out why this is necessary?
      roll = actor.perception.check.roll(params)
      break
    case 'initiative':
      const combatantId = source.combat.combatants.find(
        (c: Combatant) => c.actorId === args.characterId
      )?._id
      if (combatantId) roll = actor.initiative.roll([combatantId], { updateTurn: false })
      break
  }
  console.log('tablemate', roll)
  const r = await roll
  console.log('tablemate', r)
  if (r.hasOwnProperty('roll')) console.log('this one has a weird property') // trying to figure out where this is necessary; don't remember
  const { formula, result, total, dice } = r.hasOwnProperty('roll') ? r.roll : r
  return {
    action: 'acknowledged',
    uuid: args.uuid,
    roll: { formula, result, total, dice }
  }
}

export async function foundryCharacterAction(args: ActionArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const fakeEvent = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: source.user.settings['showDamageDialogs']
  }
  console.log('args', args)
  const actor = source.actors.get(args.characterId, { strict: true })
  const targetTokenDoc =
    args.targets.map((t: string) => source.scenes.active.tokens.get(t))[0] ?? null
  // problematic code: https://github.com/foundryvtt/pf2e/blob/2eaef272f3e17f340eba1b7f2dc82e857d8d296e/src/module/actor/actions/single-check.ts#L160
  console.log('token key', targetTokenDoc)
  const params = {
    ...args.options,
    actors: actor,
    target: targetTokenDoc?.object,
    event: fakeEvent
  }
  console.log('params', params)
  let promise
  if (args.characterAction.match('legacy.')) {
    const actionKey = args.characterAction.replace('legacy.', '')
    promise = source.pf2e.actions[actionKey](params)
  } else {
    promise = source.pf2e.actions.get(args.characterAction)?.use(params)
  }
  const r = await promise
  const { formula, result, total, dice } = r[0].roll
  return {
    action: 'acknowledged',
    uuid: args.uuid,
    roll: { formula, result, total, dice }
  }
}

export async function foundryCastSpell(args: CastArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true })
  const spellLocation = actor.items.get(item.system.location.value)

  spellLocation.cast(item, { rank: args.rank, slotId: args.slotId })
  return { action: 'acknowledged', uuid: args.uuid }
}

export async function foundryConsumeItem(args: ConsumeArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.consumableId, { strict: true })
  item.consume()
  return { action: 'acknowledged', uuid: args.uuid }
}

export function testFunction() {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  console.log('Hi, this is a test')
}
