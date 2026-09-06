// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useCharacterSkillActions } from '@/composables/character/characterSkillActions'
import { useLabelCatalogsStore } from '@/stores/labelCatalogs'
import type { TablemateCharacter } from '@/types/character-types'

// A skill action has two halves. What it IS — label, cost, traits, variants,
// description — is the same for every character in the world and now rides the
// label catalog. What it is WORTH to this character stays on the payload.
//
// That was 69KB of a 277KB payload, repeated verbatim on every refresh, so the
// halves have to reassemble exactly — and keep working across the version skew
// where a module sends the old combined shape.

const statistics = [{ statistic: 'athletics', label: 'Athletics', modifier: 9, modifiers: [] }]

const actorWith = (skillActions: unknown[]) =>
  ref({ _id: 'a', items: [], system: {}, skillActions }) as unknown as ReturnType<
    typeof ref<TablemateCharacter | undefined>
  >

describe('reassembling a skill action from its two halves', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('takes the registry half from the catalog', () => {
    const store = useLabelCatalogsStore()
    store.skillActions = {
      'force-open': {
        label: 'Force Open',
        cost: '1',
        traits: ['attack'],
        rollOptions: ['action:force-open'],
        description: '<p>Heave.</p>'
      }
    }
    // The payload now carries slug and statistics ONLY.
    const { skillActionsBySkill } = useCharacterSkillActions(
      actorWith([{ slug: 'force-open', statistics }])
    )
    const entry = skillActionsBySkill.value?.athletics?.[0]
    expect(entry?.label).toBe('Force Open')
    expect(entry?.cost).toBe('1')
    expect(entry?.traits).toEqual(['attack'])
    expect(entry?.description).toBe('<p>Heave.</p>')
    expect(entry?.modifier).toBe(9)
  })

  // Version skew, the direction that matters: a module predating the split
  // still sends everything on the payload, and there may be no catalog at all.
  it('works from the payload alone, with no catalog', () => {
    const { skillActionsBySkill } = useCharacterSkillActions(
      actorWith([
        {
          slug: 'force-open',
          label: 'Force Open',
          cost: '1',
          traits: ['attack'],
          rollOptions: [],
          statistics
        }
      ])
    )
    expect(skillActionsBySkill.value?.athletics?.[0]?.label).toBe('Force Open')
  })

  it('prefers the payload where it has an answer', () => {
    const store = useLabelCatalogsStore()
    store.skillActions = {
      'force-open': { label: 'From Catalog', traits: [], rollOptions: [] }
    }
    const { skillActionsBySkill } = useCharacterSkillActions(
      actorWith([{ slug: 'force-open', label: 'From Payload', statistics }])
    )
    expect(skillActionsBySkill.value?.athletics?.[0]?.label).toBe('From Payload')
  })

  // An action neither side can name is one nothing can render. Dropping it beats
  // showing a blank row.
  it('drops an action neither half can name', () => {
    const { skillActionsBySkill } = useCharacterSkillActions(
      actorWith([{ slug: 'mystery-action', statistics }])
    )
    expect(skillActionsBySkill.value?.athletics ?? []).toHaveLength(0)
  })

  it('still shows an action the catalog has never heard of, if the payload names it', () => {
    const store = useLabelCatalogsStore()
    store.skillActions = { 'force-open': { label: 'Force Open', traits: [], rollOptions: [] } }
    const { skillActionsBySkill } = useCharacterSkillActions(
      actorWith([{ slug: 'homebrew-action', label: 'Homebrew', statistics }])
    )
    expect(skillActionsBySkill.value?.athletics?.[0]?.label).toBe('Homebrew')
  })
})
