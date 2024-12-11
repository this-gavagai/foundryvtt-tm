import type { Actor, Action, Modifier } from '@/types/pf2e-types'
import type {
  RollCheckArgs,
  CharacterActionArgs,
  CastSpellArgs,
  ConsumeItemArgs,
  GetStrikeDamageArgs
} from '@/types/api-types'
import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import type { Game } from '@/types/foundry-types'

declare const game: Game

export async function getCharacterDetails(args: {
  actorId: string
}): Promise<UpdateCharacterDetailsArgs> {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.find((x: Actor) => x._id === args.actorId)

  // compose sending data into object
  return {
    action: 'updateCharacterDetails',
    actorId: actor._id,
    actor: JSON.stringify(actor),
    system: JSON.stringify(actor.system),
    inventory: JSON.stringify(actor.inventory),
    // TODO: serializing the whole blasts object here is inefficient. just take parts needed?
    elementalBlasts: JSON.stringify(new game.pf2e.ElementalBlast(actor))
  }
}

export async function foundryRollCheck(args: RollCheckArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const fakeEvent = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: source.user.settings['showDamageDialogs']
  }
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
  let roll
  switch (args.checkType) {
    case 'strike': {
      const [actionSlug, variant] = args.checkSubtype.split(',')
      roll = actor.system.actions
        .find((a: Action) => a.slug === actionSlug)
        .variants[variant].roll(params)
      break
    }
    case 'damage': {
      const [damageSlug, damageDegree] = args.checkSubtype.split(',')
      roll = actor.system.actions.find((a: Action) => a.slug === damageSlug)[damageDegree](params)
      break
    }
    case 'blast': {
      const [element, damageType, mapIncreases, isMelee] = args.checkSubtype.split(',')
      const blasts = new game.pf2e.ElementalBlast(actor)
      roll = blasts.attack({ ...params, element, damageType, mapIncreases, melee: isMelee })
      break
    }
    case 'blastDamage': {
      const [element, damageType, outcome, isMelee] = args.checkSubtype.split(',')
      const damageBlasts = new game.pf2e.ElementalBlast(actor)
      roll = damageBlasts.damage({ ...params, element, damageType, outcome, melee: isMelee })
      break
    }
    case 'skill': {
      params.target = null
      roll = actor.skills[args.checkSubtype].check.roll(params)
      break
    }
    case 'save': {
      params.target = null
      roll = actor.saves[args.checkSubtype].check.roll(params)
      break
    }
    case 'perception': {
      params.target = null
      roll = actor.perception.check.roll(params)
      break
    }
    case 'initiative': {
      // Not sure why I thought it needed to be this complicated. Seems to be working with just roll(params)
      // const combatantId = source.combat.combatants.find(
      //   (c: Combatant) => c.actorId === args.characterId
      // )?._id
      // if (combatantId) roll = actor.initiative.roll([combatantId], { updateTurn: false, ...params })
      params.target = null
      roll = actor.initiative.roll(params)
      break
    }
  }
  const r = await roll
  if (r.hasOwnProperty('roll')) console.log('this one has a weird property') // trying to figure out where this is necessary; don't remember
  const actualRoll = r.hasOwnProperty('roll') ? r.roll : r

  const isSecret =
    r[0]?.message?.whisper?.length === 0 || r[0]?.message?.whisper?.includes(args.userId)
  const { formula, result, total, dice } = actualRoll
  return {
    action: 'acknowledged',
    uuid: args.uuid,
    roll: { formula, result, total, dice, isSecret }
  }
}

export async function foundryCharacterAction(args: CharacterActionArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const fakeEvent = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: source.user.settings['showDamageDialogs']
  }
  const actor = source.actors.get(args.characterId, { strict: true })
  const targetTokenDoc =
    args.targets.map((t: string) => source.scenes.active.tokens.get(t))[0] ?? null
  // tricky code: https://github.com/foundryvtt/pf2e/blob/2eaef272f3e17f340eba1b7f2dc82e857d8d296e/src/module/actor/actions/single-check.ts#L160
  const params = {
    ...args.options,
    actors: actor,
    target: targetTokenDoc?.object,
    event: fakeEvent
  }
  let promise
  if (args.characterAction.match('legacy.')) {
    const actionKey = args.characterAction.replace('legacy.', '')
    promise = source.pf2e.actions[actionKey](params)
  } else {
    promise = source.pf2e.actions.get(args.characterAction)?.use(params)
  }
  const r = await promise
  console.log('TM-actionroll', r)
  console.log('tm-stuff', r[0]?.message?.whisper)
  const isSecret =
    r[0]?.message?.whisper?.length > 0 && !r[0]?.message?.whisper?.includes(args.userId)
  console.log(
    r[0]?.message?.whisper?.length === 0,
    r[0]?.message?.whisper?.includes(args.userId),
    isSecret
  )
  const { formula, result, total, dice } = r[0]?.roll
  return {
    action: 'acknowledged',
    uuid: args.uuid,
    roll: { formula, result, total, dice, isSecret }
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
export async function foundryGetStrikeDamage(args: GetStrikeDamageArgs) {
  const source = typeof window.game === 'undefined' ? parent.game : window.game
  const actor = source.actors.find((x: Actor) => x._id === args.characterId)
  const target =
    args.targets.map((t: string) => source.scenes.active.tokens.get(t))?.[0]?.object ?? null

  const fakeEvent = {
    ctrlKey: false,
    metaKey: false,
    shiftKey: source.user.settings['showDamageDialogs']
  }
  const baseDamageOptions = {
    getFormula: true,
    target: target
  }
  const baseModifierOptions = {
    context: { rollMode: 'blindroll' },
    rollMode: 'blindroll',
    createMessage: false,
    skipDialog: true,
    event: fakeEvent,
    target: target
  }

  const split = args.actionSlug.split(':')
  const isBlast = split[0] === 'blast'
  const actionString = isBlast ? split[1] : split[0]

  const action = isBlast
    ? new game.pf2e.ElementalBlast(actor)
    : actor.system.actions.find((a: Action) => a.slug === actionString)

  const doesDmg = isBlast ? true : action.item.dealsDamage
  const blastOptions = isBlast
    ? {
        element: actionString.split(',')[0],
        damageType: actionString.split(',')[1],
        melee: actionString.split(',')[2]
      }
    : {}

  const damageOptions = isBlast ? { ...baseDamageOptions, ...blastOptions } : baseDamageOptions
  const modifierOptions = isBlast
    ? { ...baseModifierOptions, ...blastOptions }
    : baseModifierOptions

  // TODO: find a less hacky way to do this. the problem here is games configured to use real dice. no way to get modifiers without actually rolling, and rollMode and skipDialog both seem to be ignored, so I'm faking events and temporarily changing client settings. bad.
  const rollmode = await source.settings.get('core', 'rollMode')
  await source.settings.set('core', 'rollMode', 'blindroll')

  const damage = doesDmg ? action.damage(damageOptions) : null
  const critical = isBlast
    ? action.damage({ ...damageOptions, outcome: 'criticalSuccess' })
    : doesDmg
      ? action.critical(damageOptions)
      : null
  // TODO: {createMessage: false} isn't respected for blasts, so there's not much I can do here
  const modifiers = doesDmg && !isBlast ? action.damage(modifierOptions) : null
  const results = await Promise.all([damage, critical, modifiers])

  await source.settings.set('core', 'rollMode', rollmode)

  console.log('modifiers', results[2]?.options?.damage?.modifiers)
  return {
    action: 'acknowledged',
    uuid: args.uuid,
    response: {
      damage: results[0],
      critical: results[1],
      modifiers: results[2]?.options?.damage?.modifiers
    }
  }
}
