import type { Actor, Action, Modifier } from '@/types/pf2e-types'
import type {
  RollCheckArgs,
  CharacterActionArgs,
  CastSpellArgs,
  ConsumeItemArgs
} from '@/types/api-types'
import type { UpdateCharacterDetailsArgs } from '@/types/api-types'

export async function getCharacterDetails(args: {
  actorId: string
}): Promise<UpdateCharacterDetailsArgs> {
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
  const modifiers = actor.system.actions.map((action: Action) =>
    action.damage({ createMessage: false, skipDialog: true, event: fakeEvent })
  )

  // await Promise.all([...damages, ...crits]).then((values) => {
  // TODO (refactor): rebundle tmDamageFormula. Should not defined as part of type but rather as separate thing maybe?
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
    system: JSON.stringify(actor.system)
    // feats: JSON.stringify(actor.feats)
  }
}

export async function foundryRollCheck(args: RollCheckArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const fakeEvent = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: source.user.settings['showDamageDialogs']
  }
  console.log('tablemate roll', args)
  //https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = source.actors.get(args.characterId, { strict: true })
  const modifiers = args.modifiers.map((m: Modifier) => {
    return new source.pf2e.Modifier(m)
  })
  const targetTokenDoc =
    args.targets?.map((t: string) => source.scenes.active.tokens.get(t))[0] ?? null
  const params = {
    modifiers: modifiers,
    target: targetTokenDoc?.object,
    skipDialog: true,
    event: fakeEvent
  }
  console.log('params', params)
  let roll
  switch (args.checkType) {
    case 'strike':
      const [actionSlug, variant] = args.checkSubtype.split(',')
      roll = actor.system.actions
        .find((a: Action) => a.slug === actionSlug)
        .variants[variant].roll(params)
      break
    case 'damage':
      const [damageSlug, crit] = args.checkSubtype.split(',')
      roll = actor.system.actions.find((a: Action) => a.slug === damageSlug)[crit](params)
      break
    case 'skill':
      params.target = null
      roll = actor.skills[args.checkSubtype].check.roll(params)
      break
    case 'save':
      params.target = null
      roll = actor.saves[args.checkSubtype].check.roll(params)
      break
    case 'perception':
      params.target = null
      roll = actor.perception.check.roll(params)
      break
    case 'initiative':
      // Not sure why I thought it needed to be this complicated. Seems to be working with just roll(params)
      // const combatantId = source.combat.combatants.find(
      //   (c: Combatant) => c.actorId === args.characterId
      // )?._id
      // if (combatantId) roll = actor.initiative.roll([combatantId], { updateTurn: false, ...params })
      params.target = null
      roll = actor.initiative.roll(params)
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

export async function foundryCharacterAction(args: CharacterActionArgs) {
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
  // tricky code: https://github.com/foundryvtt/pf2e/blob/2eaef272f3e17f340eba1b7f2dc82e857d8d296e/src/module/actor/actions/single-check.ts#L160
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

export async function foundryCastSpell(args: CastSpellArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true })
  const spellLocation = actor.items.get(item.system.location.value)

  spellLocation.cast(item, { rank: args.rank, slotId: args.slotId })
  return { action: 'acknowledged', uuid: args.uuid }
}

export async function foundryConsumeItem(args: ConsumeItemArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.consumableId, { strict: true })
  item.consume()
  return { action: 'acknowledged', uuid: args.uuid }
}
