import { type Ref, computed } from 'vue'
import type { Field, Maybe } from './helpers'
import { type Actor } from '@/types/pf2e-types'
import { useApi } from '../api'
import type { UpdateEventArgs } from '@/types/foundry-types'

export interface CharacterRules {
  rollOptions: Field<Map<string, RollOption>>
}
interface RollOption {
  sourceId: Maybe<string>
  label: Maybe<string>
  toggleable: Maybe<boolean>
  value: Maybe<boolean>
  alwaysActive: Maybe<boolean>
  suboptions: { label: Maybe<string>; value: Maybe<string> }[]
  selection: Maybe<string>
  updateRule: (
    newToggleValue: boolean | undefined | null,
    newSelection: string | null
  ) => Promise<UpdateEventArgs>
}

export function useCharacterRules(actor: Ref<Actor | undefined>): CharacterRules {
  const { updateActorItem } = useApi()
  const rollOptions = computed(() => {
    const rollOptions = new Map<string, RollOption>()
    actor.value?.items.forEach((item) => {
      item.system.rules.forEach((rule) => {
        if (
          rule.key === 'RollOption' &&
          actor.value?.activeRules.includes(rule.option) &&
          (rule.toggleable === true || rule.suboptions?.length > 0)
        ) {
          if (!rollOptions.get(rule.option)) {
            rollOptions.set(rule.option, {
              sourceId: item?._id,
              label: rule?.label ?? item.name ?? '',
              toggleable: rule?.toggleable,
              value: rule?.value,
              alwaysActive: rule?.alwaysActive,
              suboptions: [],
              selection: rule?.selection,
              updateRule: (newToggleValue, newSelection) => {
                const itemSet = actor.value?.items
                  ?.filter((i) => i?.system?.rules.some((r) => r?.option === rule?.option))
                  ?.map((i) => i._id)
                const updateSet: object[] = []
                itemSet?.forEach((i) => {
                  const rules = actor.value?.items.find((j) => j._id === i)?.system.rules
                  const rollOptionRule = rules?.find(
                    (r) => r.option === rule?.option && r.key === 'RollOption'
                  )
                  if (rollOptionRule) {
                    if (newToggleValue !== null) rollOptionRule.value = newToggleValue
                    if (newSelection !== null) rollOptionRule.selection = newSelection
                  }
                  const update = { system: { rules: rules } }
                  updateSet.push(update)
                })
                return updateActorItem(actor as Ref<Actor>, itemSet ?? [], updateSet ?? [])
              }
            })
          }
          const rollOption = rollOptions.get(rule.option)
          rule.suboptions?.forEach((s) => {
            rollOption?.suboptions.push({ label: s.label, value: s.value })
          })
        }
      })
    })
    return rollOptions
  })
  return {
    rollOptions
  }
}
