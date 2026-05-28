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
  SetWeaponDamageTypeArgs,
  ToggleKineticAuraArgs,
  CastStaffSpellArgs,
  FreeRollArgs,
  UpdateCharacterDetailsArgs
} from '@/types/api-types'
import { useBackgroundRoll } from './backgroundRoll'
import { logger } from '@/utils/utilities'
import { TM } from '@/api/protocol'
import { inventoryTypes } from '@/utils/constants'

declare const game: GamePF2e
declare const Macro: typeof MacroPF2e
declare function fromUuidSync(uuid: string): MacroPF2e

type FoundryRoll = {
  formula: string
  total: number
  result: string
  dice: { faces: number; results: { result: number }[] }[]
  evaluate: () => Promise<FoundryRoll>
  toMessage: (
    data?: { speaker?: { actor?: string } },
    opts?: { rollMode?: 'publicroll' | 'gmroll' | 'blindroll' | 'selfroll' }
  ) => Promise<unknown>
}
declare const Roll: new (formula: string) => FoundryRoll

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

function localizeProficiencyLabels(system: CharacterPF2e['system']): Record<string, string> {
  const WEAPON_CATEGORIES = ['unarmed', 'simple', 'martial', 'advanced']
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

function localizeRollOptionLabels(actor: CharacterPF2e): Record<string, string> {
  type StatWithLabel = { label?: string }
  type RuleWithLabel = { key?: string; label?: string; suboptions?: { label?: string }[] }
  const labels: Record<string, string> = {}
  for (const [slug, skill] of Object.entries(actor.system?.skills ?? {}))
    if ((skill as StatWithLabel).label)
      labels[slug] = game.i18n.localize((skill as StatWithLabel).label!)
  for (const [slug, save] of Object.entries(actor.system?.saves ?? {}))
    if ((save as StatWithLabel).label)
      labels[slug] = game.i18n.localize((save as StatWithLabel).label!)
  const percLabel = (actor.system?.perception as StatWithLabel | undefined)?.label
  if (percLabel) labels['perception'] = game.i18n.localize(percLabel)
  for (const item of actor.items) {
    if (item.slug && item.name) labels[item.slug] = item.name
    for (const rule of (item.system.rules as RuleWithLabel[]) ?? []) {
      if (rule.key === 'RollOption') {
        if (rule.label) labels[rule.label] = game.i18n.localize(rule.label)
        for (const sub of rule.suboptions ?? [])
          if (sub.label) labels[sub.label] = game.i18n.localize(sub.label)
      }
    }
  }
  return labels
}

function buildSpellcastingModifiers(actor: CharacterPF2e): Record<string, object> {
  type SpellcastingStatistic = { mod?: number; check?: { modifiers?: RawModifier[] } }
  const result: Record<string, object> = {}
  for (const item of actor.items) {
    if (item.type !== 'spellcastingEntry') continue
    const stat = (item as ItemPF2e<CharacterPF2e> & { statistic?: SpellcastingStatistic }).statistic
    result[item._id ?? ''] = {
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
  return result
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
  // elementalBlasts has a circular `actor` back-reference
  const cleanBlasts = elementalBlasts
    ? JSON.parse(JSON.stringify(elementalBlasts, blastReplacer))
    : null
  // Languages are stored on the actor as bare slugs; need to be localized
  const langKeys = CONFIG.PF2E.languages as Record<string, string>
  const languages = (actor.system?.details?.languages?.value ?? []).map((slug: string) =>
    langKeys[slug] ? game.i18n.localize(langKeys[slug]) : slug
  )
  const proficiencyLabels = localizeProficiencyLabels(actor.system)
  const rollOptionLabels = localizeRollOptionLabels(actor)
  const spellcastingModifiers = buildSpellcastingModifiers(actor)
  // Some PF2e conditions grant child conditions in-memory only (e.g. Grabbed
  // grants Off-Guard and Immobilized via `GrantItem` rule elements with
  // `inMemoryOnly: true`). These grants live on `actor.conditions` rather
  // than `actor.items`; the default JSON serialization (which boils down to
  // `actor._source`) drops them entirely. Merge the two sources here so the
  // wire payload reflects what the Foundry runtime actually sees.
  const baseItems = [...actor.items].map((i) => {
    const obj = i.toObject() as { _id?: string; system?: Record<string, unknown> }
    // toObject() returns source data, so for weapons system.damage.damageType
    // is the BASE type and the modular toggle is just a numeric index whose
    // options array isn't serialized. Overlay the *current* damage type so
    // the client can highlight the right damage-type chip.
    if (i.type === 'weapon') {
      const w = i as unknown as WeaponPF2e
      // Modular weapons: the active option's damageType lives on the prepared
      // toggle config. Fall back to the prepared system.damage.damageType for
      // everything else (e.g. versatile carries the string in `selected` and
      // base weapons just have their innate type).
      const modularDmg = w.system.traits?.toggles?.modular?.config?.damageType
      const prepared = modularDmg ?? w.system.damage?.damageType
      if (prepared) {
        const sys = (obj.system ??= {})
        const dmg = (sys.damage as { damageType?: string } | undefined) ?? {}
        ;(sys.damage as { damageType?: string }) = { ...dmg, damageType: prepared }
      }
    }
    return obj
  })
  const seenIds = new Set(baseItems.map((i) => i._id))
  const inMemoryConditions = [...actor.conditions]
    .filter((c) => !seenIds.has(c.id))
    .map((c) => c.toObject())
  const actorPayload = {
    ...actor.toObject(),
    items: [...baseItems, ...inMemoryConditions]
  }
  logger.debug('TABLEMATE: now sending ' + actor.name)
  return {
    action: TM.UPDATE_CHARACTER,
    actorId: actor._id ?? '',
    actor: actorPayload,
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

  // r[0] handles array-form results (e.g. strike variants); hasOwnProperty guards against
  // the inherited Roll.prototype.roll() method being mistaken for a data wrapper.
  const rollEl = (r as RollResult)[0] ?? r
  const actualRoll = (
    Object.prototype.hasOwnProperty.call(rollEl, 'roll') ? (rollEl as RollResult).roll : rollEl
  ) as RollResult | undefined

  const isSecret =
    (r?.[0]?.message?.whisper?.length ?? 0) > 0 && !r?.[0]?.message?.whisper?.includes(args.userId)
  const { formula, result, total, dice } = actualRoll ?? {}
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

export async function foundryFreeRoll(args: FreeRollArgs) {
  logger.debug('free roll', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const { registerBackgroundRoll, unregisterBackgroundRoll } = useBackgroundRoll(args.diceResults)
  registerBackgroundRoll()
  const roll = await new Roll('1d20').evaluate()
  await roll.toMessage(
    { speaker: { actor: actor._id ?? undefined } },
    { rollMode: args.secret ? 'blindroll' : 'publicroll' }
  )
  unregisterBackgroundRoll()
  return {
    ...makeAck(args),
    roll: {
      formula: roll.formula,
      result: String(roll.total),
      total: roll.total,
      dice: roll.dice,
      isSecret: args.secret
    }
  } as ReturnType<typeof makeAck> & { roll: { formula: string; result: string; total: number; dice: unknown; isSecret: boolean } }
}

export async function foundryCastStaffSpell(args: CastStaffSpellArgs) {
  logger.debug('cast staff spell', args)
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })
  const entryId = `${args.staffId}-casting`
  type SpellCol = { get: (id: string) => SpellPF2e<ActorPF2e<null>> | undefined }
  type Spellcasting = { get: (id: string) => SpellcastingEntryPF2e<ActorPF2e<null>> | undefined; collections: { get: (id: string) => SpellCol | undefined } }
  const spellcasting = actor.spellcasting as unknown as Spellcasting
  const entry = spellcasting.get(entryId)
  const spell = spellcasting.collections.get(entryId)?.get(args.spellId)
  if (entry && spell) {
    // Pass spontaneous: { entryId: '' } — pf2e-dailies filters spontaneous entries by
    // entryId, so a blank ID matches nothing, entries.length === 0, and the dialog is
    // skipped. The cast proceeds straight to the normal charge-deduction path.
    await (entry as unknown as { cast: (spell: SpellPF2e<ActorPF2e<null>>, options: object) => Promise<void> }).cast(spell, {
      rank: args.rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
      spontaneous: { entryId: '' }
    })
  }
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

export async function foundryToggleKineticAura(args: ToggleKineticAuraArgs) {
  const KINETIC_AURA_EFFECT_UUID = 'Compendium.pf2e.feat-effects.Item.pLurcSPQb2gjAzoP'
  const KINETIC_AURA_DEFAULT_RADIUS = 10
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

export async function foundrySetWeaponDamageType(args: SetWeaponDamageTypeArgs) {
  const source = getGame()
  const ack = makeAck(args)
  const actor = source.actors.get(args.characterId, { strict: true })
  const weapon = actor.items.get(args.weaponId, { strict: true }) as WeaponPF2e<ActorPF2e<null>>
  // Versatile takes a DamageType string; modular takes an index into
  // its options array (each option's damageType is the candidate type).
  if (args.trait === 'modular') {
    const options = weapon.system.traits.toggles.modular?.options ?? []
    const idx = args.selected === null
      ? null
      : options.findIndex((o) => o.damageType === args.selected)
    await weapon.system.traits.toggles.update({
      trait: 'modular',
      selected: idx === -1 ? null : idx
    })
  } else {
    await weapon.system.traits.toggles.update({
      trait: 'versatile',
      selected: args.selected as DamageType | null
    })
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
