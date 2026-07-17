import { type Ref, computed } from 'vue'
import type { Field, Maybe } from './helpers'
import type { TablemateCharacter } from '@/types/character-types'
import { updateActorItem } from '@/api/documents'
import type DocumentSocketResponse from '@7h3laughingman/foundry-types/common/abstract/socket.mjs'

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
  ) => Promise<DocumentSocketResponse>
}

type RollOptionRule = {
  key?: string
  option?: string
  toggleable?: boolean
  value?: boolean
  alwaysActive?: boolean
  suboptions?: { label?: string; value?: string }[]
  selection?: string
  label?: string
}

export function useCharacterRules(actor: Ref<TablemateCharacter | undefined>): CharacterRules {
  const rollOptions = computed(() => {
    const rollOptions = new Map<string, RollOption>()
    const activeRules = actor.value?.activeRules
    actor.value?.items.forEach((item) => {
      ;(item.system.rules as RollOptionRule[]).forEach((rule) => {
        if (
          rule.key === 'RollOption' &&
          activeRules?.includes(rule.option ?? '') &&
          (rule.toggleable === true || (rule.suboptions?.length ?? 0) > 0)
        ) {
          if (!rollOptions.get(rule.option ?? '')) {
            const labels = actor.value?.rollOptionLabels
            rollOptions.set(rule.option ?? '', {
              sourceId: item?._id ?? undefined,
              label: (rule.label ? labels?.[rule.label] : undefined) ?? item.name ?? '',
              toggleable: rule?.toggleable,
              value: rule?.value,
              alwaysActive: rule?.alwaysActive,
              suboptions: [],
              selection: rule?.selection,
              updateRule: (newToggleValue, newSelection) => {
                const itemSet = actor.value?.items
                  ?.filter((i) =>
                    (i?.system?.rules as RollOptionRule[]).some((r) => r?.option === rule?.option)
                  )
                  ?.map((i) => i._id!)
                const updateSet: object[] = []
                itemSet?.forEach((i) => {
                  const rules = actor.value?.items.find((j) => j._id === i)?.system.rules as
                    | RollOptionRule[]
                    | undefined
                  const rollOptionRule = rules?.find(
                    (r) => r.option === rule?.option && r.key === 'RollOption'
                  )
                  if (rollOptionRule) {
                    if (newToggleValue !== null) rollOptionRule.value = newToggleValue ?? undefined
                    if (newSelection !== null) rollOptionRule.selection = newSelection ?? undefined
                  }
                  const update = { system: { rules: rules } }
                  updateSet.push(update)
                })
                return updateActorItem(actor, itemSet ?? [], updateSet ?? [])
              }
            })
          }
          const rollOption = rollOptions.get(rule.option ?? '')
          rule.suboptions?.forEach((s) => {
            const labels = actor.value?.rollOptionLabels
            const label = s.label
              ? s.label.includes('{item|')
                ? s.label.replace(/\{item\|name\}/g, item.name ?? s.label)
                : (labels?.[s.label] ?? s.label)
              : undefined
            rollOption?.suboptions.push({ label, value: s.value })
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
