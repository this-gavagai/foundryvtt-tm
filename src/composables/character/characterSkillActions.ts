import { computed, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useLabelCatalogsStore } from '@/stores/labelCatalogs'
import type { SkillActionVariant, TablemateCharacter } from '@/types/character-types'
import type { Field } from './helpers'
import type { RequestResolutionArgs } from '@/types/api-types'
import { type Modifier, makeModifiers } from './defs/modifier'
import { rollCheck } from '@/api/actionRpc'

// A skill action surfaced under one of its parent skills. `modifier`/`modifiers`
// are the resolved total + breakdown for THIS skill (incl. action-specific
// feat/item bonuses computed Foundry-side); `rollAction` replays the action's
// roll options so the live roll lands on the same number. The shape matches
// StatBox's variant prop so it can be passed straight through.
export interface SkillActionForSkill {
  key: string
  label: string
  cost?: string
  traits: string[]
  modifier: number
  modifiers: Modifier[]
  // Enriched HTML description (from the pf2e.actionspf2e compendium) for display
  // in the action modal; undefined when the action has no compendium item.
  description?: string
  // Set only for actions PF2e refuses to roll without a named variant (Create a
  // Diversion, Perform). The UI offers these as a second row of chips and sends
  // the chosen slug back as `options.variant`.
  variants?: SkillActionVariant[]
  rollAction: (result?: number, options?: object) => Promise<RequestResolutionArgs | null>
}

export interface CharacterSkillActions {
  // skill slug → actions usable with that skill, alphabetised by label.
  skillActionsBySkill: Field<Record<string, SkillActionForSkill[]>>
}

export function useCharacterSkillActions(
  actor: Ref<TablemateCharacter | undefined>
): CharacterSkillActions {
  // What each action IS comes from the world catalog; what it is WORTH to this
  // character comes from the payload. A module predating that split still sends
  // both together, so the payload's own copy wins where it has one — which also
  // means an action the catalog has never heard of still renders.
  const { skillActions: registry } = storeToRefs(useLabelCatalogsStore())

  const skillActionsBySkill = computed<Record<string, SkillActionForSkill[]>>(() => {
    const map: Record<string, SkillActionForSkill[]> = {}
    for (const action of actor.value?.skillActions ?? []) {
      const known = registry.value[action.slug]
      const label = action.label ?? known?.label
      // No label from either side is an action nothing can render.
      if (!label) continue
      for (const stat of action.statistics) {
        const entry: SkillActionForSkill = {
          key: action.slug,
          label,
          cost: action.cost ?? known?.cost,
          traits: action.traits ?? known?.traits ?? [],
          modifier: stat.modifier,
          modifiers: makeModifiers(stat.modifiers) ?? [],
          description: action.description ?? known?.description,
          variants: action.variants ?? known?.variants,
          // Rolls through PF2e's native action (the 'skillAction' handler runs
          // game.pf2e.actions.get(slug).use(...)), so the card, traits, target
          // DC, degree of success and notes all come from the system.
          //
          // The user's toggles arrive already split into the two channels PF2e
          // needs — `modifierOverrides` for a modifier on the skill statistic,
          // `extraRollOptions` for one gated by a predicate like
          // `action:steal:pocketed`, which is answered by declaring the option and
          // letting PF2e's own evaluator decide. `useModifierOverrides` performs
          // that split for every panel now, off the `enableOptions` this payload
          // already carries, so this no longer re-derives it from the raw list.
          //
          // The channel is NAMED differently here: `Action#use` takes
          // `rollOptions` and merges them with the action's own, where a bare
          // statistic check takes `extraRollOptions`. That rename is the only
          // thing left for this function to do.
          rollAction: (result?: number, options: object = {}) => {
            const { extraRollOptions, ...rest } = options as {
              extraRollOptions?: string[]
              rollOptions?: string[]
            }
            const rollOptions = [...(rest.rollOptions ?? []), ...(extraRollOptions ?? [])]
            return rollCheck(
              actor,
              'skillAction',
              { slug: action.slug },
              { d20: [result ?? 0] },
              [],
              {
                // `options.variant` (the chip the user picked for a
                // multi-variant action) rides along in this spread — PF2e's
                // use() reads it and resolves the variant's traits, notes and
                // `action:<slug>:<variant>` roll option itself.
                ...rest,
                statistic: stat.statistic,
                rollOptions
              }
            )
          }
        }
        ;(map[stat.statistic] ??= []).push(entry)
      }
    }
    for (const slug of Object.keys(map)) {
      map[slug].sort((a, b) => a.label.localeCompare(b.label))
    }
    return map
  })
  return { skillActionsBySkill }
}
