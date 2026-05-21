import type {
  ActorPF2e,
  CharacterPF2e,
  ItemPF2e,
  PhysicalItemPF2e,
  WeaponPF2e,
  RawModifier,
  RollOptionRuleElement,
  GamePF2e,
  MacroPF2e,
  EffectTrait,
  DamageType,
  StatisticRollParameters,
  SpellPF2e,
  ConsumablePF2e,
  SpellcastingEntryPF2e,
  ActionUseOptions
} from '@7h3laughingman/pf2e-types'
import type {
  RollCheckArgs,
  CharacterActionArgs,
  CastSpellArgs,
  ConsumeItemArgs,
  GetStrikeDamageArgs,
  RequestCharacterDetailsArgs,
  SendItemToChatArgs,
  CallMacroArgs,
  SetWeaponLoadedArgs,
  ToggleKineticAuraArgs,
  UpdateCharacterDetailsArgs
} from '@/types/api-types'
import { useBackgroundRoll } from './backgroundRoll'
import { logger } from '@/utils/utilities'
import { TM } from '@/api/protocol'
import { inventoryTypes } from '@/utils/constants'

declare const game: GamePF2e
declare const Macro: typeof MacroPF2e
declare function fromUuidSync(uuid: string): MacroPF2e

type StrikeRollFn = (opts: object) => Promise<unknown>
type StrikeActionRuntime = {
  slug: string
  item: { dealsDamage: boolean } | null
  altUsages?: StrikeActionRuntime[]
  variants: { label: string; roll: StrikeRollFn }[]
  damage: StrikeRollFn
  critical: StrikeRollFn
}
type SaveKey = 'fortitude' | 'reflex' | 'will'

function getGame(): GamePF2e {
  return (typeof window.game === 'undefined' ? parent.game : window.game) as GamePF2e
}

function getCharacter(source: GamePF2e, id: string): CharacterPF2e {
  return source.actors.get(id, { strict: true }) as unknown as CharacterPF2e
}

function makeAck(args: { uuid: string }) {
  return { action: TM.ACK, uuid: args.uuid, userId: game.user._id }
}

function makeFakeEvent(source: GamePF2e) {
  return { ctrlKey: false, metaKey: false, shiftKey: source.user.settings['showDamageDialogs'] }
}

function blastReplacer(key: string, element: ActorPF2e | ItemPF2e) {
  if (key === 'actor') return undefined
  else if (key === 'item') return { _id: (element as ItemPF2e)?._id }
  else return element
}

const WEAPON_CATEGORIES = ['unarmed', 'simple', 'martial', 'advanced']

// Martial-proficiency labels (weapon/armor categories, class DCs) are stored as
// bare slugs or i18n keys and resolved at sheet-render time by PF2e; the raw
// system data we send carries the unresolved values. Mirror PF2e's own label
// logic here so each proficiency arrives already localized.
// See pf2e: CharacterSheetPF2e#getData (martialProficiencies) and #prepareClassDC.
function localizeProficiencyLabels(system: CharacterPF2e['system']): Record<string, string> {
  const cfg = CONFIG.PF2E as unknown as {
    weaponCategories: Record<string, string>
    weaponGroups: Record<string, string>
    baseWeaponTypes: Record<string, string>
    baseShieldTypes: Record<string, string>
    armorCategories: Record<string, string>
  }
  const toPascal = (slug: string) =>
    slug.replace(/(?:^|-)(\w)/g, (_m, c: string) => c.toUpperCase())
  const labels: Record<string, string> = {}

  const attacks = (system?.proficiencies?.attacks ?? {}) as Record<string, { label?: string }>
  for (const [key, data] of Object.entries(attacks)) {
    const group = /^weapon-group-([-\w]+)$/.exec(key)
    const base = /^weapon-base-([-\w]+)$/.exec(key)
    let label: string | undefined
    if (key in cfg.weaponCategories) {
      label = WEAPON_CATEGORIES.includes(key)
        ? game.i18n.localize('PF2E.Actor.Character.Proficiency.Attack.' + toPascal(key))
        : game.i18n.localize(cfg.weaponCategories[key])
    } else if (group) {
      label = game.i18n.localize(cfg.weaponGroups[group[1]] ?? group[1])
    } else if (base) {
      const bt = base[1]
      label = game.i18n.localize(cfg.baseWeaponTypes[bt] ?? cfg.baseShieldTypes[bt] ?? bt)
    } else if (data.label) {
      label = game.i18n.localize(data.label)
    }
    if (label) labels[key] = label
  }

  const defenses = (system?.proficiencies?.defenses ?? {}) as Record<string, { label?: string }>
  for (const [key, data] of Object.entries(defenses)) {
    if (key in cfg.armorCategories) {
      labels[key] = game.i18n.localize('PF2E.Actor.Character.Proficiency.Defense.' + toPascal(key))
    } else if (data.label) {
      labels[key] = game.i18n.localize(data.label)
    }
  }

  const classDCs = (system?.proficiencies?.classDCs ?? {}) as Record<string, { label?: string }>
  for (const [key, data] of Object.entries(classDCs)) {
    if (data.label) labels[key] = game.i18n.localize(data.label)
  }

  return labels
}

export async function getCharacterDetails(
  args: RequestCharacterDetailsArgs
): Promise<UpdateCharacterDetailsArgs> {
  const source = getGame()
  const actor = getCharacter(source, args.actorId)
  const elementalBlasts =
    actor.type !== 'party' ? { ...new game.pf2e.ElementalBlast(actor), actor: actor } : null
  const bulk = actor.inventory.bulk
  const inventory = {
    bulk: {
      max: bulk.max,
      bulk: bulk.bulk,
      encumberedAfter: bulk.encumberedAfter,
      encumberedAfterBreakdown: bulk.encumberedAfterBreakdown,
      maxBreakdown: bulk.maxBreakdown,
      value: { value: bulk.value.value, light: bulk.value.light, normal: bulk.value.normal }
    },
    labels: [...actor.items].reduce((acc: Record<string, string | undefined>, i: ItemPF2e) => {
      if (inventoryTypes.some((t) => t.type === i.type)) {
        acc[i._id ?? ''] = i.name
        ;(i as PhysicalItemPF2e)?.subitems?.forEach((s: ItemPF2e) => (acc[s._id ?? ''] = s.name))
      }
      return acc
    }, {})
  }
  const activeRules = new Set<string>()
  actor.rules.forEach((r) => {
    const ro = r as RollOptionRuleElement
    if (ro.option && ro.predicate.test([])) activeRules.add(ro.option)
  }, [])
  // elementalBlasts has a circular `actor` back-reference and pulls in entire
  // item objects; round-trip through blastReplacer once to flatten it into a
  // plain serializable object. Other fields are already JSON-safe (Foundry
  // documents define toJSON), so socket.io can serialize them directly.
  const cleanBlasts = elementalBlasts
    ? JSON.parse(JSON.stringify(elementalBlasts, blastReplacer))
    : null
  // Languages are stored on the actor as bare slugs; everything else PF2e sends
  // (feat/spell/item names) is already localized, so resolve them here too.
  // CONFIG.PF2E.languages maps each slug to its i18n key (version-proof — the key
  // path has differed across PF2e releases); homebrew slugs fall back to the slug.
  const langKeys = CONFIG.PF2E.languages as Record<string, string>
  const languages = (actor.system?.details?.languages?.value ?? []).map((slug: string) =>
    langKeys[slug] ? game.i18n.localize(langKeys[slug]) : slug
  )
  const proficiencyLabels = localizeProficiencyLabels(actor.system)
  const rollOptionLabels: Record<string, string> = {}
  type StatWithLabel = { label?: string }
  for (const [slug, skill] of Object.entries(actor.system?.skills ?? {}))
    if ((skill as StatWithLabel).label)
      rollOptionLabels[slug] = game.i18n.localize((skill as StatWithLabel).label!)
  for (const [slug, save] of Object.entries(actor.system?.saves ?? {}))
    if ((save as StatWithLabel).label)
      rollOptionLabels[slug] = game.i18n.localize((save as StatWithLabel).label!)
  const percLabel = (actor.system?.perception as StatWithLabel | undefined)?.label
  if (percLabel) rollOptionLabels['perception'] = game.i18n.localize(percLabel)
  for (const item of actor.items) {
    if (item.slug && item.name) rollOptionLabels[item.slug] = item.name
    type RuleWithLabel = { key?: string; label?: string; suboptions?: { label?: string }[] }
    for (const rule of (item.system.rules as RuleWithLabel[]) ?? []) {
      if (rule.key === 'RollOption') {
        if (rule.label) rollOptionLabels[rule.label] = game.i18n.localize(rule.label)
        for (const sub of rule.suboptions ?? [])
          if (sub.label) rollOptionLabels[sub.label] = game.i18n.localize(sub.label)
      }
    }
  }
  type SpellcastingStatistic = { mod?: number; check?: { modifiers?: RawModifier[] } }
  const spellcastingModifiers: Record<string, object> = {}
  for (const item of actor.items) {
    if (item.type !== 'spellcastingEntry') continue
    const stat = (item as ItemPF2e<CharacterPF2e> & { statistic?: SpellcastingStatistic }).statistic
    spellcastingModifiers[item._id ?? ''] = {
      mod: stat?.mod ?? 0,
      modifiers: (stat?.check?.modifiers ?? []).map((m: RawModifier) => ({
        slug: m.slug,
        label: m.label,
        modifier: m.modifier,
        enabled: m.enabled,
        hideIfDisabled: m.hideIfDisabled
      }))
    }
  }
  logger.debug('TABLEMATE: now sending ' + actor.name)
  return {
    action: TM.UPDATE_CHARACTER,
    actorId: actor._id ?? '',
    actor,
    system: actor.system,
    languages,
    proficiencyLabels,
    inventory,
    activeRules: [...activeRules],
    elementalBlasts: cleanBlasts,
    spellcastingModifiers,
    rollOptionLabels,
    uuid: args.uuid,
    userId: game.user._id ?? ''
  }
}

export async function foundryRollCheck(args: RollCheckArgs) {
  const source = getGame()
  //https://github.com/foundryvtt/pf2e/blob/68988e12fbec7ea8359b9bee9b0c43eb6964ca3f/src/module/system/statistic/statistic.ts#L617
  const actor = getCharacter(source, args.characterId)
  const modifiers = args.modifiers.map((m) => {
    return new source.pf2e.Modifier(m)
  })
  const targetTokenDoc =
    args.targets?.map((t: string) => source.scenes.active?.tokens.get(t))[0] ?? null
  const params = {
    modifiers: modifiers,
    target: ['strike', 'damage', 'blast', 'blastDamage', 'spellAttack'].includes(args.checkType)
      ? targetTokenDoc?.object
      : null,
    skipDialog: true,
    event: makeFakeEvent(source) as PointerEvent,
    identifier: 'tm_background'
  }

  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  registerBackgroundRoll()
  let roll
  switch (args.checkType) {
    case 'strike': {
      const [actionSlug, variant, altUsage] = args.checkSubtype.split(',')
      logger.debug("here's some stuff", args.checkSubtype, altUsage, altUsage?.length)
      const baseStrike = actor.system.actions.find((a) => a.slug === actionSlug) as
        | StrikeActionRuntime
        | undefined
      const strikeTarget = altUsage?.length ? baseStrike?.altUsages?.[Number(altUsage)] : baseStrike
      roll = strikeTarget?.variants[Number(variant)]?.roll(params)
      break
    }
    case 'damage': {
      logger.debug('TM-params', params)
      const [damageSlug, damageDegree, damageAltUsage] = args.checkSubtype.split(',')
      const baseDmgStrike = actor.system.actions.find((a) => a.slug === damageSlug) as
        | StrikeActionRuntime
        | undefined
      const dmgTarget = damageAltUsage?.length
        ? baseDmgStrike?.altUsages?.[Number(damageAltUsage)]
        : baseDmgStrike
      roll = damageDegree === 'critical' ? dmgTarget?.critical(params) : dmgTarget?.damage(params)
      break
    }
    case 'blast': {
      const [element, damageType, mapIncreases, isMelee] = args.checkSubtype.split(',')
      const blasts = new game.pf2e.ElementalBlast(actor)
      roll = blasts.attack({
        ...params,
        element: element as EffectTrait,
        damageType: damageType as DamageType,
        mapIncreases: Number(mapIncreases),
        melee: isMelee === 'true'
      })
      break
    }
    case 'blastDamage': {
      const [element, damageType, outcome, isMelee] = args.checkSubtype.split(',')
      const damageBlasts = new game.pf2e.ElementalBlast(actor)
      roll = damageBlasts.damage({
        ...params,
        element: element as EffectTrait,
        damageType: damageType as DamageType,
        outcome: outcome as 'success' | 'criticalSuccess',
        melee: isMelee === 'true'
      })
      break
    }
    case 'skill': {
      roll = actor.skills[args.checkSubtype].check.roll({
        ...args.options,
        ...params
      } as StatisticRollParameters)
      break
    }
    case 'save': {
      roll = actor.saves[args.checkSubtype as SaveKey].check.roll({
        ...args.options,
        ...params
      } as StatisticRollParameters)
      break
    }
    case 'perception': {
      roll = actor.perception.check.roll(params as StatisticRollParameters)
      break
    }
    case 'initiative': {
      roll = actor.initiative.roll(params as StatisticRollParameters)
      break
    }
    case 'spellAttack': {
      roll = actor.spellcasting
        .get(args.checkSubtype)
        ?.statistic?.check.roll({ ...args.options, ...params } as StatisticRollParameters)
      break
    }
    case 'flat': {
      const label = 'Generic Flat Check'
      const dc = (args.options as { dc?: number }).dc ?? 11
      roll = game.pf2e.Check.roll(new game.pf2e.StatisticModifier(label, []), {
        actor: {} as ActorPF2e,
        type: 'flat-check',
        dc: { value: dc, visible: true },
        options: new Set(['flat-check']),
        createMessage: true,
        skipDialog: true
      })
      break
    }
  }
  type RollResult = {
    formula?: unknown
    result?: unknown
    total?: unknown
    dice?: unknown
    roll?: { formula?: unknown; result?: unknown; total?: unknown; dice?: unknown }
    [n: number]: { message?: { whisper?: string[] } } | undefined
  }
  const rRaw = await roll
  unregisterBackgroundRoll()
  if (!rRaw) return {}
  const r = rRaw as RollResult

  if (r.hasOwnProperty('roll')) logger.debug('this one has a weird property') // trying to figure out where this is necessary; don't remember
  const actualRoll = r.roll ?? r

  const isSecret =
    r[0]?.message?.whisper?.length === 0 && !r[0]?.message?.whisper?.includes(args.userId)
  const { formula, result, total, dice } = actualRoll
  return { ...makeAck(args), roll: { formula, result, total, dice, isSecret } }
}

export async function foundryCharacterAction(args: CharacterActionArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const targetTokenDoc =
    args.targets.map((t: string) => source.scenes.active?.tokens.get(t))[0] ?? null
  // tricky code: https://github.com/foundryvtt/pf2e/blob/2eaef272f3e17f340eba1b7f2dc82e857d8d296e/src/module/actor/actions/single-check.ts#L160
  const params = {
    ...args.options,
    actors: actor,
    target: targetTokenDoc?.object,
    event: makeFakeEvent(source)
  }

  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  registerBackgroundRoll()

  const promise = source.pf2e.actions
    .get(args.characterAction)
    ?.use(params as unknown as Partial<ActionUseOptions>)
  type ActionResult = {
    message?: { whisper?: string[] }
    roll?: { formula: unknown; result: unknown; total: unknown; dice: unknown }
  }
  const r = (await promise) as ActionResult[] | undefined
  logger.debug(r, promise, args.characterAction)
  const isSecret =
    (r?.[0]?.message?.whisper?.length ?? 0) > 0 && !r?.[0]?.message?.whisper?.includes(args.userId)
  const { formula, result, total, dice } = r?.[0]?.roll ?? {}
  unregisterBackgroundRoll()
  return { ...makeAck(args), roll: { formula, result, total, dice, isSecret } }
}

export async function foundryCastSpell(args: CastSpellArgs) {
  logger.debug('cast spell', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.id, { strict: true }) as SpellPF2e<ActorPF2e<null>>
  const locationId = item.system.location.value
  const spellLocation = locationId
    ? (actor.items.get(locationId) as SpellcastingEntryPF2e<ActorPF2e<null>>)
    : undefined
  await spellLocation?.cast(item, {
    rank: args.rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
    slotId: args.slotId
  })
  return makeAck(args)
}

export async function foundryConsumeItem(args: ConsumeItemArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const item = actor.items.get(args.consumableId, { strict: true }) as ConsumablePF2e<
    ActorPF2e<null>
  >
  item.consume()
  return makeAck(args)
}

// Load/unload a weapon using PF2e's native mechanism: loaded ammo lives in the
// weapon's `subitems` (the same state the default character sheet's reload
// button manages via WeaponPF2e#attach / subitem#detach). Loading attaches the
const KINETIC_AURA_EFFECT_UUID = 'Compendium.pf2e.feat-effects.Item.pLurcSPQb2gjAzoP'
const KINETIC_AURA_DEFAULT_RADIUS = 10

export async function foundryToggleKineticAura(args: ToggleKineticAuraArgs) {
  const source = getGame()
  const ack = makeAck(args)
  const actor = source.actors.get(args.characterId, { strict: true })
  const existingAura = actor.items.find((i: ItemPF2e) => i.slug === 'effect-kinetic-aura')
  if (existingAura) {
    await existingAura.delete()
  } else {
    // Fetch the effect from compendium and pre-set the ChoiceSet selection so
    // PF2e skips the aura-radius dialog and uses the default 10ft radius.
    const effectDoc = await fromUuid(KINETIC_AURA_EFFECT_UUID)
    if (effectDoc) {
      type RuleData = { key: string; selection?: number }
      const effectData = (effectDoc as ItemPF2e).toObject()
      const choiceSet = (effectData.system.rules as RuleData[]).find((r) => r.key === 'ChoiceSet')
      if (choiceSet) choiceSet.selection = KINETIC_AURA_DEFAULT_RADIUS
      await actor.createEmbeddedDocuments('Item', [effectData])
    }
  }
  return ack
}

// weapon's selected ammo; unloading detaches whatever is currently loaded.
export async function foundrySetWeaponLoaded(args: SetWeaponLoadedArgs) {
  const source = getGame()
  const ack = makeAck(args)

  const actor = source.actors.get(args.characterId, { strict: true })
  const weapon = actor.items.get(args.weaponId, { strict: true }) as WeaponPF2e<ActorPF2e<null>>
  const loadedAmmo = weapon.subitems.filter(
    (i: PhysicalItemPF2e) =>
      i.isOfType('ammo') || (i.isOfType('weapon') && (i as WeaponPF2e).isAmmoFor(weapon))
  )

  if (args.loaded) {
    // Only load the explicitly-chosen ammo (no automatic fallback).
    const ammo = args.ammoId ? actor.inventory.get(args.ammoId) : undefined
    const capacity = (weapon.system.ammo as { capacity?: number } | null)?.capacity ?? 1
    const numLoaded = loadedAmmo.reduce((sum, a) => sum + (a.quantity ?? 0), 0)
    if (ammo && capacity - numLoaded > 0) {
      await weapon.attach(ammo, { quantity: 1, stack: true })
    }
  } else {
    for (const sub of loadedAmmo) await sub.detach({ skipConfirm: true })
  }
  return ack
}

export async function foundrySendItemToChat(args: SendItemToChatArgs) {
  const actor = game.actors.get(args.characterId)
  const item = actor?.items?.get(args.itemId)

  if (item) item.toChat()
  return makeAck(args)
}

export async function foundryCallMacro(args: CallMacroArgs) {
  logger.debug('running macro', args)
  if (!args.compendiumName) return
  const actor = game.actors.get(args.characterId)
  const pack = game.packs.get(args.compendiumName)

  if (args.macroUuid) {
    const macro = fromUuidSync(args.macroUuid)
    // TODO: test args.targets stuff
    logger.debug(args.targets)
    macro.execute({ scope: { actor, targets: args.targets } })
  } else {
    if (!pack) return Promise.resolve(null)
    const macro_data = (await pack.getDocuments())
      .find((i: { name: string }) => i.name === args.macroName)
      ?.toObject()
    if (!macro_data) return Promise.resolve(null)
    const temp_macro = new Macro(macro_data)
    temp_macro.type = 'script'
    temp_macro.execute({ actor })
  }

  return makeAck(args)
}

export async function foundryGetStrikeDamage(args: GetStrikeDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)
  const target =
    args.targets.map((t: string) => source.scenes.active?.tokens.get(t))?.[0]?.object ?? null

  const split = args.actionSlug.split(':')
  const isBlast = split[0] === 'blast'
  const actionString = isBlast ? split[1] : split[0]

  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll()
  registerBackgroundRoll()

  let damage: Promise<unknown> | null
  let critical: Promise<unknown> | null
  let modifiers: Promise<unknown> | null

  if (isBlast) {
    const [element, damageType, isMelee] = actionString.split(',')
    const blast = new game.pf2e.ElementalBlast(actor)
    type BlastParams = Parameters<typeof blast.damage>[0]
    const blastBase: BlastParams = {
      element: element as EffectTrait,
      damageType: damageType as DamageType,
      melee: isMelee === 'true',
      getFormula: true,
      target
    }
    damage = blast.damage(blastBase)
    critical = blast.damage({ ...blastBase, outcome: 'criticalSuccess' })
    modifiers = null
  } else {
    const baseDamageOptions = { getFormula: true, target }
    const baseModifierOptions = {
      context: { rollMode: 'blindroll' },
      rollMode: 'blindroll',
      createMessage: false,
      skipDialog: true,
      event: makeFakeEvent(source),
      target
    }
    const baseStrike = actor.system.actions.find((a) => a.slug === actionString) as
      | StrikeActionRuntime
      | undefined
    const strike = args.altUsage !== undefined ? baseStrike?.altUsages?.[args.altUsage] : baseStrike
    const doesDmg = strike?.item?.dealsDamage ?? false
    damage = doesDmg && strike ? strike.damage(baseDamageOptions) : null
    critical = doesDmg && strike ? strike.critical(baseDamageOptions) : null
    modifiers = doesDmg && strike ? strike.damage(baseModifierOptions) : null
  }

  const results = await Promise.all([damage, critical, modifiers])
  unregisterBackgroundRoll()

  type DamageModifiers = { options?: { damage?: { modifiers?: unknown[] } } }
  return {
    ...makeAck(args),
    response: {
      damage: results[0],
      critical: results[1],
      modifiers: (results[2] as DamageModifiers | null)?.options?.damage?.modifiers
    }
  }
}
