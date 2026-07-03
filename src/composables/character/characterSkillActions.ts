import { computed, type Ref } from 'vue'
import type { RawModifier } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
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
  rollAction: (result?: number, options?: object) => Promise<RequestResolutionArgs | null>
}

export interface CharacterSkillActions {
  // skill slug → actions usable with that skill, alphabetised by label.
  skillActionsBySkill: Field<Record<string, SkillActionForSkill[]>>
}

export function useCharacterSkillActions(
  actor: Ref<TablemateCharacter | undefined>
): CharacterSkillActions {
  const skillActionsBySkill = computed<Record<string, SkillActionForSkill[]>>(() => {
    const map: Record<string, SkillActionForSkill[]> = {}
    for (const action of actor.value?.skillActions ?? []) {
      for (const stat of action.statistics) {
        const entry: SkillActionForSkill = {
          key: action.slug,
          label: action.label,
          cost: action.cost,
          traits: action.traits,
          modifier: stat.modifier,
          modifiers: makeModifiers(stat.modifiers as unknown as RawModifier[]) ?? [],
          description: action.description,
          // Rolls through PF2e's native action (the 'skillAction' handler runs
          // game.pf2e.actions.get(slug).use(...)), so the card, traits, target
          // DC, degree of success and notes all come from the system. We split
          // the user's modifier toggles into two channels:
          //   - statistic modifiers (feats/items on the skill) → modifierOverrides
          //   - conditional ACTION modifiers (e.g. Steal's "pocketed") → their
          //     native sub-roll-options, since they live on the action, not the
          //     skill, and are gated by predicates like `action:steal:pocketed`.
          rollAction: (result?: number, options: object = {}) => {
            const overrides =
              (options as { modifierOverrides?: Record<string, boolean> }).modifierOverrides ?? {}
            const rollOptions: string[] = [
              ...((options as { rollOptions?: string[] }).rollOptions ?? [])
            ]
            const actionSlugs = new Set<string>()
            for (const m of stat.modifiers) {
              if (!m.fromAction || !m.slug) continue
              actionSlugs.add(m.slug)
              const on = m.slug in overrides ? overrides[m.slug] : m.enabled
              if (on && m.enableOptions?.length) rollOptions.push(...m.enableOptions)
            }
            // Statistic-only overrides — action modifiers are handled via options.
            const statOverrides = Object.fromEntries(
              Object.entries(overrides).filter(([slug]) => !actionSlugs.has(slug))
            )
            return rollCheck(
              actor,
              'skillAction',
              action.slug,
              { d20: [result ?? 0] },
              [],
              {
                ...options,
                statistic: stat.statistic,
                rollOptions,
                modifierOverrides: statOverrides
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
