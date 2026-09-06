import { computed, type Ref } from 'vue'
import { useDerivedModifiers } from './derivedModifiers'
import type {
  Immunity,
  Weakness,
  Resistance,
  MartialProficiency,
  ClassDCData,
  SaveType
} from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Field, WritableField, Maybe } from './helpers'
import { type Modifier, makeModifiers } from './defs/modifier'
import { type Stat, makeStat } from './defs/stat'
import { rollCheck } from '@/api/actionRpc'
import { updateActorItem } from '@/api/documents'
import type { RequestResolutionArgs } from '@/types/api-types'
import { kebabCase } from 'lodash-es'
import { calcAttribute } from './calcAttributes'
import { i18n } from '@/plugins/i18n'
import { heldShield, type ShieldSource } from '@/utils/heldShield'
import { useWorldLabels } from '@/composables/useWorldLabels'
import { useDerivedStatistics } from './derivedStatistics'
import type { EngineItem } from '@/utils/ruleEngine/flatModifiers'
import { asDocumentArray } from '@/api/internal'

export interface IWR {
  type: Maybe<string>
  label: string
  exceptions: Maybe<string[]>
  definition: Maybe<string>
  value?: Maybe<number>
}
export function makeIWRs(
  set: (Immunity | Weakness | Resistance)[] | undefined,
  labels?: Record<string, string>
): IWR[] | undefined {
  if (!set) return undefined
  return set.map((e) => ({
    type: e.type,
    // A `custom` type has no dictionary entry and no meaning as a slug — PF2e
    // shows the label the granting rule carries, and so does this.
    label:
      (e as { customLabel?: string | null }).customLabel ||
      ((e.type && labels?.[e.type]) ?? e.type?.replace(/-/g, ' ') ?? ''),
    // Optional in source data even though the PF2e type declares it required:
    // an entry with no exceptions simply omits the key (`{"type":"curse"}`),
    // and the app holds wire JSON rather than a live document that would have
    // filled the default in. Reading it unguarded threw inside a computed and
    // took the whole sheet down to a blank page — on 68 of 173 openable actors
    // in a real world. `exceptions` is Maybe<string[]>, so undefined is a
    // value the field already accepts, and nothing renders it today.
    exceptions: e.exceptions?.map((ex) => (typeof ex === 'string' ? ex : ex.label)),
    definition: undefined,
    value: e.value as number | undefined
  }))
}

export interface CharacterStats {
  // stats
  attributes: {
    str: Field<number>
    dex: Field<number>
    con: Field<number>
    int: Field<number>
    wis: Field<number>
    cha: Field<number>
  }
  ac: {
    current: Field<number>
    modifiers: Field<Modifier[]>
    // True when this AC is the rule engine's rather than PF2e's AND the engine
    // had gaps. Never true for a figure that came from a character payload.
    provisional: Field<boolean>
    caveat: Field<string>
  }
  shield: {
    hp: {
      current: WritableField<number>
      max: Field<number>
      brokenThreshold: Field<number>
    }
    ac: Field<number>
    hardness: Field<number>
    raised: Field<boolean>
    broken: Field<boolean>
    destroyed: Field<boolean>
    itemId: Field<string>
  }
  saves: {
    fortitude: Field<Stat>
    reflex: Field<Stat>
    will: Field<Stat>
  }
  perception: Field<Stat>
  skills: Field<Stat[]>
  proficiencies: Field<Stat[]>
  immunities: Field<IWR[]>
  weaknesses: Field<IWR[]>
  resistances: Field<IWR[]>
  spellDC: Field<number>

  doFlatCheck: (
    rollResult?: number | undefined,
    options?: object | undefined
  ) => Promise<RequestResolutionArgs>
}

export function useCharacterStats(actor: Ref<TablemateCharacter | undefined>): CharacterStats {
  // IWR and proficiency names are the world's, not this actor's — see
  // composables/useWorldLabels.
  const { iwrLabels, proficiencyLabels } = useWorldLabels(actor)
  // Tier-2 figures, for the sheet no GM has answered for. Every one of these is
  // consulted only when the payload has no number of its own, and carries a
  // provisional marker when the rule engine could not account for everything.
  const derived = useDerivedStatistics(actor)

  // A statistic the payload supplied, or the engine's stand-in for it. The
  // prepared trace wins whenever it exists — it is PF2e's own answer, modifier
  // breakdown and all, which the engine cannot reproduce.
  //
  // The fallback arrives as a THUNK, not a value. Passed by value it was
  // evaluated as an argument before this function could decide it was not
  // needed, so with a GM online every skill, save and defence was derived in
  // full and thrown away — measured at 4.2ms per sheet render for a 100-item
  // character, on hardware far quicker than the tablet this runs on. The
  // derivation is only cheap when it does not happen.
  const statOrDerived = (
    prepared: Stat | undefined,
    fallback: () => { value: number; provisional: boolean; caveat: string } | undefined,
    slug: string,
    label: string
  ): Stat | undefined => {
    if (prepared?.value !== undefined || prepared?.totalModifier !== undefined) return prepared
    const derivedFigure = fallback()
    if (!derivedFigure) return prepared
    return {
      ...(prepared ?? { slug, label }),
      slug: prepared?.slug ?? slug,
      label: prepared?.label ?? label,
      value: derivedFigure.value,
      totalModifier: derivedFigure.value,
      provisional: derivedFigure.provisional,
      caveat: derivedFigure.caveat
    } as Stat
  }
  const attributes = {
    str: computed(() => actor.value?.system?.abilities?.str?.mod ?? calcAttribute(actor, 'str')),
    dex: computed(() => actor.value?.system?.abilities?.dex?.mod ?? calcAttribute(actor, 'dex')),
    con: computed(() => actor.value?.system?.abilities?.con?.mod ?? calcAttribute(actor, 'con')),
    int: computed(() => actor.value?.system?.abilities?.int?.mod ?? calcAttribute(actor, 'int')),
    wis: computed(() => actor.value?.system?.abilities?.wis?.mod ?? calcAttribute(actor, 'wis')),
    cha: computed(() => actor.value?.system?.abilities?.cha?.mod ?? calcAttribute(actor, 'cha'))
  }
  const derivedAc = derived.armorClass
  const derivedModifiers = useDerivedModifiers()
  const ac = {
    current: computed(() => actor.value?.system?.attributes?.ac?.value ?? derivedAc.value?.value),
    // Whether the AC on screen is the engine's rather than PF2e's, and whether
    // the engine had gaps. Read by ArmorClass to mark the figure.
    provisional: computed(
      () =>
        actor.value?.system?.attributes?.ac?.value === undefined && !!derivedAc.value?.provisional
    ),
    caveat: computed(() =>
      actor.value?.system?.attributes?.ac?.value === undefined ? derivedAc.value?.caveat : undefined
    ),
    modifiers: computed(() => {
      const reported = actor.value?.system?.attributes?.ac?.modifiers
      if (reported) return makeModifiers(reported)
      // The engine builds the same three rows PF2e does — attribute,
      // proficiency by rank, and the worn armour as one item bonus — so the AC
      // modal has a breakdown with no GM instead of an empty list.
      return derivedModifiers.present(derivedAc.value?.modifiers)
    })
  }
  // PF2e's shield block is a copy off the held shield item, so it rides a
  // character payload and is absent from the world dump. Fall back to deriving
  // it from the actor's own items (utils/heldShield) — otherwise the whole
  // readout stays hidden on a sheet no GM has answered for. The prepared block
  // wins whenever it is there, since it carries rune-adjusted numbers this
  // cannot; see the bound documented in that module.
  const derivedShield = computed(() => heldShield(actor.value?.items as ShieldSource[] | undefined))
  const preparedShield = computed(() => actor.value?.system?.attributes?.shield)
  const shieldField = <T>(
    fromPrepared: (s: NonNullable<typeof preparedShield.value>) => T | undefined,
    fromItems: (s: NonNullable<ReturnType<typeof heldShield>>) => T
  ) =>
    computed(() => {
      const prepared = preparedShield.value
      if (prepared?.itemId) return fromPrepared(prepared)
      const derived = derivedShield.value
      return derived ? fromItems(derived) : undefined
    })

  const shield = {
    hp: {
      current: computed({
        get: () =>
          preparedShield.value?.itemId
            ? actor.value?.system?.attributes?.shield?.hp?.value
            : derivedShield.value?.hp.value,
        set: (newValue) => {
          const shieldId = actor.value?.system?.attributes?.shield?.itemId
          actor.value!.system.attributes.shield.hp.value = newValue!
          const update = { system: { hp: { value: newValue } } }
          // Fire-and-forget: recovery (refresh + rethrow) happens in updateActorItem.
          updateActorItem(actor, shieldId ?? '', update).catch(() => {})
        }
      }),
      max: shieldField(
        (s) => s.hp?.max,
        (s) => s.hp.max
      ),
      brokenThreshold: shieldField(
        (s) => (s.hp as { brokenThreshold?: number })?.brokenThreshold,
        (s) => s.hp.brokenThreshold
      )
    },
    ac: shieldField(
      (s) => s.ac,
      (s) => s.ac
    ),
    hardness: shieldField(
      (s) => s.hardness,
      (s) => s.hardness
    ),
    // `raised` is an active effect, not a shield property — the sheet derives it
    // from the actor's effects either way, so there is nothing to fall back to.
    raised: computed(() => actor.value?.system?.attributes?.shield?.raised),
    broken: shieldField(
      (s) => s.broken,
      (s) => s.broken
    ),
    destroyed: shieldField(
      (s) => s.destroyed,
      (s) => s.destroyed
    ),
    itemId: shieldField(
      (s) => s.itemId ?? undefined,
      (s) => s.itemId
    )
  }
  const makeSave = (subtype: SaveType) => {
    const fallback = derived.save(subtype)
    return computed(() => ({
      ...(statOrDerived(
        makeStat(actor.value?.system?.saves?.[subtype]),
        () => fallback.value,
        subtype,
        subtype
      ) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(actor, 'save', { slug: subtype }, { d20: [result ?? 0] }, [], options ?? {})
    }))
  }
  const saves = {
    fortitude: makeSave('fortitude'),
    reflex: makeSave('reflex'),
    will: makeSave('will')
  }
  const perception = computed(() => ({
    ...(statOrDerived(
      makeStat(actor.value?.system?.perception),
      () => derived.perception.value,
      'perception',
      'Perception'
    ) as Stat),
    roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
      rollCheck(actor, 'perception', undefined, { d20: [result ?? 0] }, [], options ?? {})
  }))

  const skills = computed(() => {
    const skills = Object.entries(actor.value?.system?.skills ?? [])?.map(
      ([key, skill]) =>
        ({
          ...statOrDerived(
            makeStat(skill, key),
            () => derived.skill(key, (skill as { rank?: number })?.rank ?? 0),
            key,
            key
          ),
          roll: (result, options = {}) =>
            rollCheck(
              actor,
              'skill',
              { slug: skill.slug ?? '' },
              { d20: [result ?? 0] },
              [],
              options ?? {}
            )
        }) as Stat
    )
    const skillSlugs = new Set(skills.map((s) => s.slug))
    const lores: Stat[] = (actor.value?.items
      .filter((i) => i.type === 'lore' && !skillSlugs.has(kebabCase(i.name)))
      .map((lore) => {
        const slug = kebabCase(lore.name)
        const rank = (lore.system as { proficient?: { value?: number } })?.proficient?.value ?? 0
        const fallback = derived.skill(slug, rank, true)
        return {
          slug,
          label: lore.name,
          lore: true,
          rank,
          // A lore never appears in the payload's skill list, so it has no
          // prepared figure to prefer — the engine's is all there is.
          value: fallback?.value,
          totalModifier: fallback?.value,
          provisional: fallback?.provisional,
          caveat: fallback?.caveat,
          // PF2e exposes lore stats at actor.skills[slug] just like core skills,
          // so the foundry-side 'skill' check handler dispatches them via the
          // same path.
          roll: (result?: number, options: object = {}) =>
            rollCheck(actor, 'skill', { slug }, { d20: [result ?? 0] }, [], options)
        }
      }) ?? []) as Stat[]
    return lores.length ? [...skills, ...lores] : skills
  })

  const proficiencies = computed(() => {
    const labels = proficiencyLabels.value
    return [
      ...Object.entries(
        (actor.value?.system?.proficiencies?.['attacks'] ?? []) as Record<
          string,
          MartialProficiency
        >
      ).map(
        ([key, stat]) =>
          ({
            ...makeStat({ ...stat, label: labels[key] ?? stat.label }, key),
            type: 'attacks',
            slug: key
          }) as Stat
      ),
      ...Object.entries(
        (actor.value?.system?.proficiencies?.['defenses'] ?? []) as Record<
          string,
          MartialProficiency
        >
      ).map(
        ([key, stat]) =>
          ({
            ...makeStat({ ...stat, label: labels[key] ?? stat.label }, key),
            type: 'defenses',
            slug: key
          }) as Stat
      ),
      ...Object.entries(
        (actor.value?.system?.proficiencies?.['classDCs'] ?? []) as Record<string, ClassDCData>
      ).map(
        ([key, stat]) =>
          ({
            ...makeStat({ ...stat, label: labels[key] ?? stat.label }, key),
            type: 'classDCs',
            slug: key
          }) as Stat
      ),
      ...[
        {
          ...(makeStat(actor.value?.system?.proficiencies?.['spellcasting']) as Stat),
          value: actor.value?.system?.attributes?.classOrSpellDC?.value,
          type: 'spellcasting',
          slug: 'Spell DC',
          label: i18n.global.t('proficiencyTypes.spellDC')
        }
      ]
    ]
  })

  // ONE path, not a payload-wins fallback, because the merge is idempotent:
  // PF2e keeps the HIGHER value for a type already present, so folding the rule
  // elements into a list that already contains them changes nothing. On the
  // world-dump path they are the only IWR there is.
  //
  // Worth the departure from the pattern the other figures use. Eight of ten
  // characters on the test table carry rule-element IWR and six have nothing
  // authored at all, so a fallback that only fired when the list was absent
  // would still have shown those six an empty panel — their lists are not
  // absent, they are empty.
  const iwrSet = (kind: 'immunities' | 'weaknesses' | 'resistances') =>
    computed(() => {
      const derivedSet = derived.iwr.value?.[kind]
      const stored = actor.value?.system?.attributes?.[kind]
      if (!derivedSet) return makeIWRs(stored, iwrLabels.value)
      return makeIWRs(derivedSet as unknown as Immunity[], iwrLabels.value)
    })
  const immunities = iwrSet('immunities')
  const weaknesses = iwrSet('weaknesses')
  const resistances = iwrSet('resistances')
  // PF2e's `spellDC` is the best DC across the actor's spellcasting entries, so
  // the fallback derives each entry and takes the highest — one character can
  // carry two, keyed off different attributes.
  const spellDC = computed(() => {
    const prepared = actor.value?.system?.attributes?.spellDC?.value
    if (prepared !== undefined) return prepared
    const entries = ((asDocumentArray(actor.value?.items) ?? []) as EngineItem[]).filter(
      (item) => item?.type === 'spellcastingEntry'
    )
    const derivedDcs = entries
      .map((entry) => derived.spellDC(entry)?.value)
      .filter((value): value is number => typeof value === 'number')
    return derivedDcs.length ? Math.max(...derivedDcs) : undefined
  })

  const doFlatCheck = (
    rollResult: number | undefined = undefined,
    options: object | undefined = {}
  ) => {
    return rollCheck(actor, 'flat', undefined, { d20: [rollResult ?? 0] }, [], options ?? {})
  }

  return {
    attributes,
    ac,
    shield,
    saves,
    perception,
    skills,
    proficiencies,
    immunities,
    weaknesses,
    resistances,
    spellDC,
    doFlatCheck
  }
}
