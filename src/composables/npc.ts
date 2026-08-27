import { computed, type Ref } from 'vue'
import type {
  AbilityItemPF2e,
  AbstractEffectPF2e,
  ConditionPF2e,
  NPCStrike as PF2eNpcStrike,
  SaveType,
  SlotKey,
  SpellPF2e,
  SpellcastingEntryPF2e,
  WeaponPF2e
} from '@7h3laughingman/pf2e-types'
import type { TablemateNpc } from '@/types/character-types'
import type { Actor } from '@/composables/actor'
import type { Field, Maybe, WritableField } from '@/composables/character/helpers'
import { type Action, makeAction } from '@/composables/character/defs/action'
import { makeCondition } from '@/composables/character/defs/condition'
import { makeEffect } from '@/composables/character/defs/effect'
import { makeModifiers } from '@/composables/character/defs/modifier'
import { type Stat, makeStat } from '@/composables/character/defs/stat'
import { type Strike, makeStrike } from '@/composables/character/defs/strikeDef'
import {
  type Spell,
  type SpellcastingEntry,
  makeSpell,
  makeSpellcastingEntry
} from '@/composables/character/defs/spellDef'
import { makeIWRs } from '@/composables/character/characterStats'
import { makeSpellRankResolver } from '@/utils/spellcasting'
import { tokenPortrait } from '@/utils/tokenPortrait'
import { deleteActorItem, updateActor, updateActorItem } from '@/api/documents'
import { castSpell, getSpellDamage, getStrikeDamage, rollCheck, rollDamage } from '@/api/actionRpc'
import { formatTraitLabel } from '@/utils/traitLabels'
import type { DiceResults } from '@/types/api-types'

type StatInput = Parameters<typeof makeStat>[0]

// A localized sense entry off the perception statistic's trace data (PF2e's
// PerceptionStatistic#getTraceData already resolves `label` into the world
// locale, so nothing here needs re-localizing client-side).
export interface NpcSense {
  type: Maybe<string>
  label: Maybe<string>
  acuity: Maybe<string>
  range: Maybe<number>
}

// An NPC strike. PF2e builds these from the NPC's `melee` items rather than
// from carried weapons, so there are no alt usages, no ammunition and no
// damage-type toggles — but there *are* attack effects ("Grab", "Knockdown")
// that ride along with a successful hit, which characters never have.
export interface NpcStrike extends Strike {
  isRanged: Maybe<boolean>
  range: Maybe<number>
  attackEffects: string[]
}

// An NPC's spell, with the two things a stat block needs that the character
// sheet gets from elsewhere: the rank it is actually cast at (innate entries
// heighten heavily), and the per-spell innate uses that stand in for slots.
export interface NpcSpell extends Spell {
  castRank: Maybe<number>
  uses: Maybe<{ value: Maybe<number>; max: Maybe<number> }>
  // Innate spells are spent per spell rather than per slot, so the GM tracks
  // them here. Absent on spells that aren't innate.
  setUses?: (newValue: number) => ReturnType<typeof updateActorItem>
}

export interface Npc extends Actor {
  _actor: Ref<TablemateNpc | undefined>
  type: Field<string>
  level: Field<number>
  // The one-line creature description shown under the name ("Ferocious canine").
  blurb: Field<string>
  publicNotes: Field<string>
  rarity: Field<string>
  size: Field<string>
  traits: Field<string[]>
  // "elite"/"weak" when the GM has applied a level adjustment, else null.
  adjustment: Field<string | null>
  senses: Field<NpcSense[]>
  // Free-text clarifications the stat block carries next to a statistic
  // (e.g. AC "22 (24 with shield raised)", saves "+1 status to all vs. magic").
  perceptionDetails: Field<string>
  acDetails: Field<string>
  hpDetails: Field<string>
  allSavesDetails: Field<string>
  speedDetails: Field<string>
  strikes: Field<NpcStrike[]>
  // Abilities split the way PF2e's own NPC sheet splits them: anything with an
  // action cost is "active", everything else is a passive stat-block entry.
  activeAbilities: Field<Action[]>
  passiveAbilities: Field<Action[]>
  spellDC: Field<number>
  spellcastingEntries: Field<SpellcastingEntry[]>
  spells: Field<NpcSpell[]>
  focusPoints: {
    current: WritableField<number>
    max: Field<number>
  }
}

export function useNpc(actor: Ref<TablemateNpc | undefined>) {
  const traitLabels = computed(() => actor.value?.traitLabels ?? {})

  const makeSave = (subtype: SaveType) =>
    computed(() => ({
      ...(makeStat(actor.value?.system?.saves?.[subtype]) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(actor, 'save', { slug: subtype }, { d20: [result ?? 0] }, [], options ?? {})
    }))

  const makeSpeed = (type: 'land' | 'swim' | 'climb' | 'fly' | 'burrow') =>
    computed(() => makeStat(actor.value?.system?.movement?.speeds?.[type] as StatInput))

  const portrait = computed(() => tokenPortrait(actor.value?.prototypeToken, actor.value?.img))

  const npc: Npc = {
    _actor: actor,
    _id: computed(() => actor.value?._id ?? undefined),
    type: computed(() => actor.value?.type ?? undefined),
    name: computed(() => actor.value?.name),
    portraitUrl: computed(() => portrait.value.url),
    portraitScaleX: computed(() => portrait.value.scaleX),
    portraitScaleY: computed(() => portrait.value.scaleY),
    portraitRing: computed(() => portrait.value.ring),

    level: computed(() => actor.value?.system?.details?.level?.value),
    blurb: computed(() => actor.value?.system?.details?.blurb || undefined),
    publicNotes: computed(() => actor.value?.system?.details?.publicNotes || undefined),
    rarity: computed(() => actor.value?.system?.traits?.rarity),
    size: computed(() => actor.value?.system?.traits?.size?.value),
    traits: computed(() => [...(actor.value?.system?.traits?.value ?? [])]),
    adjustment: computed(() => actor.value?.system?.attributes?.adjustment ?? null),

    hp: {
      current: computed({
        get: () => actor.value?.system?.attributes?.hp?.value,
        set: (newValue) => {
          if (!actor.value || newValue === undefined) return
          actor.value.system.attributes.hp.value = newValue
          // Fire-and-forget: recovery (refresh + rethrow) happens in updateActor.
          void updateActor(actor, {
            system: { attributes: { hp: { value: newValue } } }
          }).catch(() => {})
        }
      }),
      max: computed(() => actor.value?.system?.attributes?.hp?.max),
      temp: computed({
        get: () => actor.value?.system?.attributes?.hp?.temp,
        set: (newValue) => {
          if (!actor.value || newValue === undefined) return
          actor.value.system.attributes.hp.temp = newValue
          void updateActor(actor, {
            system: { attributes: { hp: { temp: newValue } } }
          }).catch(() => {})
        }
      }),
      modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.hp?.modifiers))
    },
    hpDetails: computed(() => actor.value?.system?.attributes?.hp?.details || undefined),

    ac: {
      current: computed(() => actor.value?.system?.attributes?.ac?.value),
      modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.ac?.modifiers))
    },
    acDetails: computed(
      () =>
        (actor.value?.system?.attributes?.ac as { details?: string } | undefined)?.details ||
        undefined
    ),

    saves: {
      fortitude: makeSave('fortitude'),
      reflex: makeSave('reflex'),
      will: makeSave('will')
    },
    allSavesDetails: computed(() => actor.value?.system?.attributes?.allSaves?.value || undefined),

    perception: computed(() => ({
      ...(makeStat(actor.value?.system?.perception) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(actor, 'perception', undefined, { d20: [result ?? 0] }, [], options ?? {})
    })),
    perceptionDetails: computed(() => actor.value?.system?.perception?.details || undefined),
    senses: computed(() =>
      (actor.value?.system?.perception?.senses ?? []).map((sense) => ({
        type: sense.type,
        label: (sense as { label?: string | null }).label ?? undefined,
        acuity: sense.acuity ?? undefined,
        range: sense.range ?? undefined
      }))
    ),

    // NPCs carry a statistic for every skill in the system, with `visible`
    // marking the ones they are actually trained in — a stat block only lists
    // those, so everything else is dropped here rather than in the view.
    skills: computed(() =>
      Object.entries(actor.value?.system?.skills ?? {})
        .map(([key, skill]) => {
          const stat = makeStat(skill as StatInput, key)
          return {
            ...stat,
            rank: stat?.rank ?? 0,
            roll: (result, options = {}) =>
              rollCheck(actor, 'skill', { slug: key }, { d20: [result ?? 0] }, [], options ?? {})
          } as Stat
        })
        .filter((stat) => stat.visible !== false)
    ),

    movement: {
      land: makeSpeed('land'),
      swim: makeSpeed('swim'),
      climb: makeSpeed('climb'),
      fly: makeSpeed('fly'),
      burrow: makeSpeed('burrow')
    },
    // `attributes.speed` is source-only (prepared data moves the speeds to
    // `movement.speeds`), so the prepared type omits it — but the details
    // free-text is only ever stored there.
    speedDetails: computed(
      () =>
        (actor.value?.system?.attributes as { speed?: { details?: string } } | undefined)?.speed
          ?.details || undefined
    ),

    attributes: {
      str: computed(() => actor.value?.system?.abilities?.str?.mod),
      dex: computed(() => actor.value?.system?.abilities?.dex?.mod),
      con: computed(() => actor.value?.system?.abilities?.con?.mod),
      int: computed(() => actor.value?.system?.abilities?.int?.mod),
      wis: computed(() => actor.value?.system?.abilities?.wis?.mod),
      cha: computed(() => actor.value?.system?.abilities?.cha?.mod)
    },

    immunities: computed(() =>
      makeIWRs(actor.value?.system?.attributes?.immunities, actor.value?.iwrLabels)
    ),
    weaknesses: computed(() =>
      makeIWRs(actor.value?.system?.attributes?.weaknesses, actor.value?.iwrLabels)
    ),
    resistances: computed(() =>
      makeIWRs(actor.value?.system?.attributes?.resistances, actor.value?.iwrLabels)
    ),
    spellDC: computed(() => actor.value?.system?.attributes?.spellDC?.value),

    initiative: {
      stat: computed({
        get: () => actor.value?.system?.initiative?.statistic,
        set: (newValue) => {
          if (!actor.value || newValue === undefined) return
          actor.value.system.initiative.statistic =
            newValue as typeof actor.value.system.initiative.statistic
          void updateActor(actor, {
            system: { initiative: { statistic: newValue } }
          }).catch(() => {})
        }
      }),
      modifiers: computed(() => makeModifiers(actor.value?.system?.initiative?.modifiers)),
      totalModifier: computed(() => actor.value?.system?.initiative?.totalModifier),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(actor, 'initiative', undefined, { d20: [result ?? 0] }, [], options ?? {})
    },

    // Strikes come off the prepared `system.actions` — the same array the
    // character sheet reads — so the strike/damage roll handlers dispatch them
    // by slug through exactly the same Foundry-side path. Area attacks (an NPC
    // "area fire" melee item) carry a save DC instead of attack variants and
    // aren't rollable this way, so they're filtered out.
    strikes: computed(() =>
      (actor.value?.system?.actions ?? [])
        .filter((attack): attack is PF2eNpcStrike => attack?.type === 'strike')
        .map((attack) => {
          // The strike's `item` is the NPC's melee item; prefer the copy on the
          // actor (it round-trips as a full item document) and fall back to the
          // one embedded in the strike.
          const meleeItem = (actor.value?.items?.find((i) => i._id === attack.item?._id) ??
            attack.item) as unknown as WeaponPF2e | undefined
          const base = makeStrike(attack as unknown as Parameters<typeof makeStrike>[0], meleeItem)
          const isRanged =
            (meleeItem?.system as { weaponType?: { value?: string } } | undefined)?.weaponType
              ?.value === 'ranged'
          return {
            ...base,
            // NPCs have no equipment to hold, so a strike is always available.
            ready: true,
            // PF2e labels an NPC's MAP-0 variant with the localized word
            // "Strike" in front of the modifier ("Strike +18"), where the
            // character equivalent is the bare modifier — and the shared
            // StrikeActionSet renders its own "Strike" chip in front of
            // whatever the label says. Trim it back to the modifier so the
            // button reads once and the modifier-delta parse lines up.
            variants: (base?.variants ?? []).map((variant, index) => ({
              ...variant,
              label:
                index === 0
                  ? (variant.label?.match(/[+-]?\d+\s*$/)?.[0]?.trim() ?? variant.label)
                  : variant.label
            })),
            isRanged,
            range: (meleeItem?.system as { range?: number } | undefined)?.range ?? undefined,
            attackEffects: (attack.additionalEffects ?? []).map((effect) =>
              // `label` is an i18n key for the standard effects (CONFIG.PF2E
              // .attackEffects) and a plain item name for ability-granted ones;
              // the localized keys arrive in traitLabels, keyed by tag.
              effect.label?.startsWith('PF2E.')
                ? formatTraitLabel(effect.tag, traitLabels.value)
                : (effect.label ?? formatTraitLabel(effect.tag, traitLabels.value))
            ),
            getDamage: (
              _altUsage = undefined,
              _blastOptions = undefined,
              modifierOverrides = undefined
            ) => getStrikeDamage(actor, attack.slug ?? '', undefined, modifierOverrides),
            doStrike: (variant, _altUsage, _blastOptions, result, modifierOverrides) =>
              rollCheck(
                actor,
                'strike',
                { actionSlug: attack.slug ?? '', variant, altUsage: undefined },
                { d20: [result ?? 0] },
                [],
                modifierOverrides ? { modifierOverrides } : {}
              ),
            doDamage: (variant, _altUsage, _blastOptions, result, modifierOverrides) =>
              rollCheck(
                actor,
                'damage',
                {
                  actionSlug: attack.slug ?? '',
                  degree: variant ? 'critical' : 'damage',
                  altUsage: undefined
                },
                result ?? {},
                [],
                modifierOverrides ? { modifierOverrides } : {}
              )
          } as NpcStrike
        })
    ),

    activeAbilities: computed(() => npcAbilities(actor, true)),
    passiveAbilities: computed(() => npcAbilities(actor, false)),

    // Spellcasting is the same PF2e machinery characters use — entries own the
    // statistic and any slots, spells point back at their entry via
    // `location.value` — so the entry/spell shapes and the roll plumbing are
    // shared. What differs is what a bestiary caster leans on: innate entries
    // with per-spell uses instead of slots, and heavy heightening.
    spellcastingEntries: computed(() =>
      [...(actor.value?.items ?? [])]
        .filter((i) => i.type === 'spellcastingEntry')
        // Mirror Foundry's display order, which sorts items by `sort`.
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((i) => {
          const item = i as unknown as SpellcastingEntryPF2e
          const stats = item._id ? actor.value?.spellcastingModifiers?.[item._id] : undefined
          return {
            ...makeSpellcastingEntry(item),
            spellAttackModifier: stats?.mod,
            spellAttackModifiers: makeModifiers(stats?.modifiers),
            // Prefer the prepared DC: an elite/weak adjustment moves it while the
            // entry's stored spelldc.dc stays at the unadjusted book value.
            preparedDc: stats?.dc,
            doSpellAttack: (result?: number, modifierOverrides?: Record<string, boolean>) =>
              rollCheck(
                actor,
                'spellAttack',
                { entryId: item._id ?? '' },
                { d20: [result ?? 0] },
                [],
                modifierOverrides ? { modifierOverrides } : {}
              ),
            // Slot accounting only applies to an NPC's prepared/spontaneous
            // entries; innate ones carry empty `slots` and spend per spell.
            setSlotCount: (rank: number, newValue: number) =>
              updateActorItem(actor, item._id!, {
                system: { slots: { ['slot' + rank]: { value: newValue } } }
              }),
            setPrepared: (
              rank: number | undefined,
              slot: number | undefined,
              newSpellId: string | null,
              expended: boolean = false
            ) => {
              const prepared = item.system.slots?.[('slot' + rank) as SlotKey]?.prepared
              if (!prepared || rank == null || slot == null) return Promise.resolve(null)
              if (!prepared[slot]) prepared[slot] = { id: null, expended: true }
              prepared[slot].id = newSpellId
              prepared[slot].expended = expended
              return updateActorItem(actor, item._id!, {
                system: { slots: { ['slot' + rank]: { prepared } } }
              })
            }
          } as SpellcastingEntry
        })
    ),

    spells: computed(() => {
      const entries = [...(actor.value?.items ?? [])].filter((i) => i.type === 'spellcastingEntry')
      const entryById = new Map(entries.map((i) => [i._id, i as unknown as SpellcastingEntryPF2e]))
      const rankOf = makeSpellRankResolver(actor.value?.system?.details?.level?.value)
      return [...(actor.value?.items ?? [])]
        .filter((i) => i.type === 'spell')
        .map((i) => {
          const item = i as unknown as SpellPF2e
          const base = makeSpell(item)
          const entry = entryById.get(item.system?.location?.value)
          const innate = entry?.system?.prepared?.value === 'innate'
          const cantrip = base.system.traits?.value?.includes('cantrip') ?? false
          // The rank this spell goes off at, resolved exactly as the spellbook
          // files it (see makeSpellRankResolver). Cantrips are left unset so PF2e
          // auto-scales them Foundry-side.
          const castRank = cantrip
            ? undefined
            : rankOf(base, entry ? makeSpellcastingEntry(entry) : undefined)
          // Uses are the innate stand-in for slots. They arrive because the
          // Foundry side overlays the prepared value (PF2e derives a default of
          // 1/1 rather than storing one) — see getCharacterDetails.
          const uses = innate ? item.system?.location?.uses : undefined
          return {
            ...base,
            castRank,
            uses: uses ? { value: uses.value, max: uses.max } : undefined,
            setUses: innate
              ? (newValue: number) =>
                  updateActorItem(actor, item._id!, {
                    system: { location: { uses: { value: newValue } } }
                  })
              : undefined,
            // The slot index only means anything to a strict-prepared entry
            // (PF2e's consume() deducts that specific slot); innate and
            // spontaneous entries ignore it, so a missing one defaults to 0
            // rather than blocking the cast the way the character path does.
            //
            // Left OFF entirely for a spell attached to no entry: PF2e casts
            // through SpellcastingEntry#cast, so there is nothing to cast from
            // and the Foundry handler would throw. The sheet reads the absence
            // and hides the button.
            doSpell: entry
              ? (rank: number | undefined, slot: number | undefined, overlayIds?: string[]) =>
                  castSpell(actor, item._id!, rank ?? castRank ?? 1, slot ?? 0, overlayIds)
              : undefined,
            doSpellAttack: (
              attackNumber: 1 | 2 | 3,
              result?: number,
              modifierOverrides?: Record<string, boolean>,
              overlayIds?: string[]
            ) =>
              rollCheck(
                actor,
                'spellAttack',
                {
                  entryId: item.system?.location?.value ?? '',
                  spellId: item._id ?? undefined,
                  attackNumber,
                  overlayIds
                },
                { d20: [result ?? 0] },
                [],
                modifierOverrides ? { modifierOverrides } : {}
              ),
            doSpellDamage: (
              mapIncreases: 0 | 1 | 2 = 0,
              castingRank?: number,
              result?: DiceResults,
              modifierOverrides?: Record<string, boolean>,
              overlayIds?: string[]
            ) =>
              rollCheck(
                actor,
                'spellDamage',
                {
                  spellId: item._id ?? '',
                  mapIncreases,
                  castingRank: castingRank ?? castRank,
                  overlayIds
                },
                result ?? {},
                [],
                modifierOverrides ? { modifierOverrides } : {}
              ),
            getDamage: (
              castingRank?: number,
              modifierOverrides?: Record<string, boolean>,
              overlayIds?: string[]
            ) =>
              getSpellDamage(actor, item._id!, castingRank ?? castRank, modifierOverrides, overlayIds)
          } as NpcSpell
        })
    }),

    focusPoints: {
      current: computed({
        get: () => actor.value?.system?.resources?.focus?.value,
        set: (newValue) => {
          if (!actor.value || newValue === undefined) return
          actor.value.system.resources.focus!.value = newValue
          void updateActor(actor, {
            system: { resources: { focus: { value: newValue } } }
          }).catch(() => {})
        }
      }),
      max: computed(() => actor.value?.system?.resources?.focus?.max)
    },

    effects: computed(() =>
      actor.value?.items
        ?.filter((i) => ['effect', 'condition'].includes(i?.type ?? ''))
        .map((i) => {
          const item = i as unknown as AbstractEffectPF2e
          const base =
            i.type === 'condition' ? makeCondition(i as unknown as ConditionPF2e) : makeEffect(item)
          return {
            ...base,
            delete: () => deleteActorItem(actor, i._id!),
            changeQty: (newValue: number) =>
              updateActorItem(actor, i._id!, { system: { value: { value: newValue } } })
          }
        })
    ),

    languages: computed(() => actor.value?.languages),
    rollOptionLabels: computed(() => actor.value?.rollOptionLabels),
    traitLabels,

    // doCharacterAction / doFlatCheck deliberately absent: the NPC sheet is a
    // stat block, not a play surface for the PF2e action registry, and the UI
    // hides those affordances when undefined.
    doDamage: (
      formula: string,
      opts: {
        secret?: boolean
        diceResults?: DiceResults
        itemId?: string
        damageInline?: Record<string, string | true>
      } = {}
    ) => rollDamage(actor, formula, opts)
  }

  return { npc }
}

// Ability ("action") items, split on whether they cost an action to use.
// PF2e stores a passive stat-block entry as an action item whose actionType is
// 'passive'; everything else (actions, reactions, free actions) is active.
function npcAbilities(actor: Ref<TablemateNpc | undefined>, active: boolean): Action[] {
  return [...(actor.value?.items ?? [])]
    .filter((i) => i.type === 'action')
    .map((i) => {
      const item = i as unknown as AbilityItemPF2e
      const typeValue = item.system?.actionType?.value
      return {
        ...makeAction(item),
        actionType: typeValue !== 'action' ? (typeValue ?? null) : 'action'
      } as Action
    })
    .filter((ability) => (ability.actionType !== 'passive') === active)
}
