import { computed, type Ref } from 'vue'
import type {
  CharacterPF2e,
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
import { rollCheck } from '@/api/actions'
import { updateActorItem } from '@/api/documents'
import type { RequestResolutionArgs } from '@/types/api-types'
import { kebabCase } from 'lodash-es'
import { calcAttribute } from './calcAttributes'
import { i18n } from '@/plugins/i18n'

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
    exceptions: e.exceptions.map((ex) => (typeof ex === 'string' ? ex : ex.label)),
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
  const shield = {
    hp: {
      current: computed({
        get: () => actor.value?.system?.attributes?.shield?.hp?.value,
        set: (newValue) => {
          const shieldId = actor.value?.system?.attributes?.shield?.itemId
          actor.value!.system.attributes.shield.hp.value = newValue!
          const update = { system: { hp: { value: newValue } } }
          updateActorItem(actor as Ref<CharacterPF2e>, shieldId ?? '', update)
        }
      }),
      max: computed(() => actor.value?.system?.attributes?.shield?.hp?.max),
      brokenThreshold: computed(
        () =>
          (actor.value?.system?.attributes?.shield?.hp as { brokenThreshold?: number })
            ?.brokenThreshold
      )
    },
    ac: computed(() => actor.value?.system?.attributes?.shield?.ac),
    hardness: computed(() => actor.value?.system?.attributes?.shield?.hardness),
    raised: computed(() => actor.value?.system?.attributes?.shield?.raised),
    broken: computed(() => actor.value?.system?.attributes?.shield?.broken),
    destroyed: computed(() => actor.value?.system?.attributes?.shield?.destroyed),
    itemId: computed(() => actor.value?.system?.attributes?.shield?.itemId ?? undefined)
  }
  const makeSave = (subtype: SaveType) =>
    computed(() => ({
      ...(makeStat(actor.value?.system?.saves?.[subtype]) as Stat),
      roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
        rollCheck(
          actor as Ref<CharacterPF2e>,
          'save',
          subtype,
          { d20: [result ?? 0] },
          [],
          options ?? {}
        )
    }))
  const saves = {
    fortitude: makeSave('fortitude'),
    reflex: makeSave('reflex'),
    will: makeSave('will')
  }
  const perception = computed(() => ({
    ...(makeStat(actor.value?.system?.perception) as Stat),
    roll: (result: number | undefined = undefined, options: object | undefined = {}) =>
      rollCheck(
        actor as Ref<CharacterPF2e>,
        'perception',
        '',
        { d20: [result ?? 0] },
        [],
        options ?? {}
      )
  }))

  const skills = computed(() => {
    const skills = Object.entries(actor.value?.system?.skills ?? [])?.map(
      ([key, skill]) =>
        ({
          ...makeStat(skill, key),
          roll: (result, options = {}) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'skill',
              skill.slug,
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
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'skill',
              slug,
              { d20: [result ?? 0] },
              [],
              options
            )
        }
      }) ?? []) as Stat[]
    return lores.length ? [...skills, ...lores] : skills
  })

  const proficiencies = computed(() => {
    const labels = actor.value?.proficiencyLabels ?? {}
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

  const immunities = computed(() => makeIWRs(actor.value?.system?.attributes?.immunities, actor.value?.iwrLabels))
  const weaknesses = computed(() => makeIWRs(actor.value?.system?.attributes?.weaknesses, actor.value?.iwrLabels))
  const resistances = computed(() => makeIWRs(actor.value?.system?.attributes?.resistances, actor.value?.iwrLabels))
  const spellDC = computed(() => actor.value?.system?.attributes?.spellDC?.value)

  const doFlatCheck = (
    rollResult: number | undefined = undefined,
    options: object | undefined = {}
  ) => {
    return rollCheck(
      actor as Ref<CharacterPF2e>,
      'flat',
      '',
      { d20: [rollResult ?? 0] },
      [],
      options ?? {}
    )
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
