import { computed, type Ref } from 'vue'
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
    label: (e.type && labels?.[e.type]) ?? e.type?.replace(/-/g, ' ') ?? '',
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
  const attributes = {
    str: computed(() => actor.value?.system?.abilities?.str?.mod ?? calcAttribute(actor, 'str')),
    dex: computed(() => actor.value?.system?.abilities?.dex?.mod ?? calcAttribute(actor, 'dex')),
    con: computed(() => actor.value?.system?.abilities?.con?.mod ?? calcAttribute(actor, 'con')),
    int: computed(() => actor.value?.system?.abilities?.int?.mod ?? calcAttribute(actor, 'int')),
    wis: computed(() => actor.value?.system?.abilities?.wis?.mod ?? calcAttribute(actor, 'wis')),
    cha: computed(() => actor.value?.system?.abilities?.cha?.mod ?? calcAttribute(actor, 'cha'))
  }
  const ac = {
    current: computed(() => actor.value?.system?.attributes?.ac?.value),
    modifiers: computed(() => makeModifiers(actor.value?.system?.attributes?.ac?.modifiers))
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
  const makeSave = (subtype: SaveType) =>
    computed(() => ({
      ...(makeStat(actor.value?.system?.saves?.[subtype]) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(actor, 'save', { slug: subtype }, { d20: [result ?? 0] }, [], options ?? {})
    }))
  const saves = {
    fortitude: makeSave('fortitude'),
    reflex: makeSave('reflex'),
    will: makeSave('will')
  }
  const perception = computed(() => ({
    ...(makeStat(actor.value?.system?.perception) as Stat),
    roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
      rollCheck(actor, 'perception', undefined, { d20: [result ?? 0] }, [], options ?? {})
  }))

  const skills = computed(() => {
    const skills = Object.entries(actor.value?.system?.skills ?? [])?.map(
      ([key, skill]) =>
        ({
          ...makeStat(skill, key),
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
        return {
          slug,
          label: lore.name,
          lore: true,
          rank: (lore.system as { proficient?: { value?: number } })?.proficient?.value,
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

  const immunities = computed(() =>
    makeIWRs(actor.value?.system?.attributes?.immunities, iwrLabels.value)
  )
  const weaknesses = computed(() =>
    makeIWRs(actor.value?.system?.attributes?.weaknesses, iwrLabels.value)
  )
  const resistances = computed(() =>
    makeIWRs(actor.value?.system?.attributes?.resistances, iwrLabels.value)
  )
  const spellDC = computed(() => actor.value?.system?.attributes?.spellDC?.value)

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
