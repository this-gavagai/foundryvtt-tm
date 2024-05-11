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

declare const game: Game

const MODNAME = 'module.tablemate'
const source = typeof window.game === 'undefined' ? parent.game : window.game

export async function getCharacterDetails(args: { actorId: string }) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.find((x: Actor) => x._id === args.actorId)

  // add the damage formula into things
  const damages = actor.system.actions.map((action: Action) => action.damage({ getFormula: true }))
  const criticals = actor.system.actions.map((action: Action) =>
    action.critical({ getFormula: true })
  )
  const modifiers = actor.system.actions.map((action: Action) =>
    action.damage({ createMessage: false, skipDialog: true })
  )
  await Promise.all([...damages, ...criticals, ...modifiers]).then((values) => {
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
  //https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = source.actors.get(args.characterId, { strict: true })
  const modifiers = args.modifiers.map((m: Modifier) => {
    return new source.pf2e.Modifier(m)
  })
  const targetTokenDoc =
    args.targets.map((t: string) => source.scenes.active.tokens.get(t))[0] ?? null
  const params = {
    modifiers: modifiers,
    target: { document: targetTokenDoc }
    // skipDialog: args.skipDialog,
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
      roll = actor.skills[args.checkSubtype].check.roll(params)
      break
    case 'save':
      roll = actor.saves[args.checkSubtype].check.roll(params)
      break
    case 'perception':
      roll = actor.perception.check.roll(params)
      break
    case 'initiative':
      const combatantId = source.combat.combatants.find(
        (c: Combatant) => c.actorId === args.characterId
      )?._id
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

export async function foundryCharacterAction(args: ActionArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.get(args.characterId, { strict: true })
  const targetTokenDoc =
    args.targets.map((t: string) => source.scenes.active.tokens.get(t))[0] ?? null
  // TODO: (bug) find a way around pf2e's requirement for TokenPF2e objects in order to token (which isn't possible if canvas is off)
  // problematic code: https://github.com/foundryvtt/pf2e/blob/2eaef272f3e17f340eba1b7f2dc82e857d8d296e/src/module/actor/actions/single-check.ts#L160
  const params = { ...args.options, actors: actor }
  console.log('params', params)
  let promise
  if (args.characterAction.match('legacy.')) {
    const actionKey = args.characterAction.replace('legacy.', '')
    promise = source.pf2e.actions[actionKey](params)
  } else {
    console.log('params', params)
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

export async function foundryCastSpell(args: CastArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true })
  const spellLocation = actor.items.get(item.system.location.value)

  spellLocation.cast(item, { rank: args.rank, slotId: args.slotId })
  return { action: 'acknowledged', uuid: args.uuid }
  // game.socket.emit(MODNAME, { action: 'acknowledged', uuid: args.uuid })
}

export async function foundryConsumeItem(args: ConsumeArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.consumableId, { strict: true })
  item.consume()
  return { action: 'acknowledged', uuid: args.uuid }
  // game.socket.emit(MODNAME, { action: 'acknowledged', uuid: args.uuid })
}

export function testFunction() {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  console.log('Hi, this is a test')
}
