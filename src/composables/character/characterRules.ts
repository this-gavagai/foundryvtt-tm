import { type Ref, computed } from 'vue'
import type { Field, Maybe } from './helpers'
import type { TablemateCharacter } from '@/types/character-types'
import { replaceItemRules } from '@/api/documents'
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
  // Part of a RollOption's identity, not decoration: PF2e pairs rules by
  // (domain, option), so two rules sharing an option string in different
  // domains are independent toggles. See the fan-out below.
  domain?: string
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
          // Keyed by (domain, option), the pair PF2e treats as one toggle's
          // identity — keying on `option` alone collapsed two independent
          // toggles in different domains into a single row.
          const optionKey = `${rule.domain ?? ''}:${rule.option ?? ''}`
          if (!rollOptions.get(optionKey)) {
            const labels = actor.value?.rollOptionLabels
            rollOptions.set(optionKey, {
              sourceId: item?._id ?? undefined,
              label: (rule.label ? labels?.[rule.label] : undefined) ?? item.name ?? '',
              toggleable: rule?.toggleable,
              value: rule?.value,
              alwaysActive: rule?.alwaysActive,
              suboptions: [],
              selection: rule?.selection,
              // Write the toggle onto every item contributing this roll option.
              //
              // Matching PF2e's own pairing, which is (domain, option) and not
              // option alone — `#resolveSuboptionRules` filters the actor's
              // rules on `key`, `toggleable`, `mergeable`, `domain` AND
              // `option`. Two rules sharing an option string in different
              // domains are independent toggles there, and were being moved
              // together here.
              //
              // Requiring `key === 'RollOption'` in the SELECTION as well as in
              // the mutation matters for a second reason: without it an item
              // could join the set on some other rule that happens to carry the
              // same `option`, have nothing changed, and still be sent a
              // whole-array write of its rules.
              //
              // ONE deliberate divergence remains. PF2e fans out only for a
              // `mergeable` rule and otherwise writes the clicked item alone;
              // this fans out regardless. That is because the row above
              // aggregates SUBOPTIONS from every contributing item into a
              // single control, so toggling only one contributor would leave the
              // control visibly disagreeing with itself. One row, one state, all
              // contributors — coherent, and a wider net than PF2e casts for a
              // non-mergeable duplicate.
              updateRule: (newToggleValue, newSelection) => {
                const isThisOption = (r: RollOptionRule) =>
                  r?.key === 'RollOption' &&
                  r?.option === rule?.option &&
                  r?.domain === rule?.domain
                const itemSet = actor.value?.items
                  ?.filter((i) => (i?.system?.rules as RollOptionRule[]).some(isThisOption))
                  ?.map((i) => i._id!)
                // Each contributing item's WHOLE rules array, edited in place
                // and handed back — so this goes through replaceItemRules
                // rather than updateActorItem, which is what marks it as the
                // broad write it is and refuses one built from a mirror that no
                // longer holds the item. See api/documents.ts.
                const updates: { itemId: string; rules: object[] }[] = []
                itemSet?.forEach((itemId) => {
                  const rules = actor.value?.items.find((j) => j._id === itemId)?.system.rules as
                    | RollOptionRule[]
                    | undefined
                  const rollOptionRule = rules?.find(isThisOption)
                  if (rollOptionRule) {
                    if (newToggleValue !== null) rollOptionRule.value = newToggleValue ?? undefined
                    if (newSelection !== null) rollOptionRule.selection = newSelection ?? undefined
                  }
                  if (rules) updates.push({ itemId, rules })
                })
                return replaceItemRules(actor, updates)
              }
            })
          }
          const rollOption = rollOptions.get(optionKey)
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
