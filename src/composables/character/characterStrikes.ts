import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Field, WritableField } from './helpers'
import { type Strike, makeStrike, type ElementalBlast, makeElementalBlasts } from './defs/strike'
import { rollCheck, getStrikeDamage } from '@/api/actions'
import { updateActorItem } from '@/api/documents'
import type { CharacterStrike, DamageType, WeaponPF2e } from '@7h3laughingman/pf2e-types'

export interface CharacterStrikes {
  strikes: Field<Strike[]>
  blasts: Field<ElementalBlast[]>
  blastActions: WritableField<string>
}

export function useCharacterStrikes(actor: Ref<TablemateCharacter | undefined>): CharacterStrikes {
  const strikes = computed(() => {
    return (actor.value?.system?.actions as CharacterStrike[] | undefined)?.map(
      (action) =>
        ({
          ...makeStrike(
            action,
            actor.value?.items.find<WeaponPF2e<CharacterPF2e>>(
              (i) => i.system?.slug === action?.slug
            )
          ),
          getDamage: (altUsage = undefined) =>
            getStrikeDamage(actor as Ref<CharacterPF2e>, action.slug, altUsage),
          doStrike: (variant, altUsage, blastOptions, result) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'strike',
              `${action.slug},${variant},${altUsage ?? ''}`,
              {
                d20: [result ?? 0]
              }
            ),
          doDamage: (variant, altUsage) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'damage',
              `${action.slug},${variant ? 'critical' : 'damage'},${altUsage ?? ''}`
            ),
          setDamageType: (newType) => {
            const item = actor.value?.items.find<WeaponPF2e<CharacterPF2e>>(
              (i) => i._id === action?.item?._id
            )
            if (!item || !actor.value) return Promise.resolve(null)
            const adjustment = item.system?.damage?.damageType === newType ? null : newType
            const isModular = item.system?.traits?.value?.includes('modular' as never)
            const toggleKey = isModular ? 'modular' : 'versatile'
            const toggles = item.system.traits.toggles
            if (isModular) {
              if (toggles.modular) Object.assign(toggles.modular, { selected: adjustment })
            } else {
              toggles.versatile.selected = adjustment as DamageType | null
            }
            const update = {
              system: { traits: { toggles: { [toggleKey]: { selected: adjustment } } } }
            }
            return updateActorItem(actor as Ref<CharacterPF2e>, action?.item?._id ?? '', update)
          },
          changeAmmo: (newId) => {
            const item = actor.value?.items.find<WeaponPF2e<CharacterPF2e>>(
              (i) => i._id === action?.item?._id
            )
            const actorAction = (actor.value?.system.actions as CharacterStrike[])?.find(
              (a) => a.slug === action?.slug
            )
            if (item && item.system) item.system.selectedAmmoId = newId
            if (actorAction?.ammunition)
              actorAction.ammunition.selected = newId ? { id: newId, compatible: false } : null

            const update = { system: { selectedAmmoId: newId || null } }
            return (
              updateActorItem(actor as Ref<CharacterPF2e>, action?.item?._id ?? '', update) ??
              Promise.resolve(null)
            )
          }
        }) as Strike
    )
  })
  const blasts = computed(() =>
    makeElementalBlasts(actor.value?.elementalBlasts)?.map(
      (blast: ElementalBlast) =>
        ({
          ...blast,
          getDamage: (altUsage, blastOptions) =>
            getStrikeDamage(
              actor as Ref<CharacterPF2e>,
              `blast:${blastOptions?.element},${blastOptions?.damageType},${blastOptions?.isMelee}`
            ),
          doStrike: (variant, altUsage, blastOptions, result: number | undefined) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'blast',
              `${blastOptions?.element},${blastOptions?.damageType},${variant},${blastOptions?.isMelee}`,
              { d20: [result ?? 0] }
            ),
          doDamage: (variant, altUsage, blastOptions) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'blastDamage',
              `${blastOptions?.element},${blastOptions?.damageType},${variant ? 'criticalSuccess' : 'success'},${blastOptions?.isMelee}`
            ),
          setDamageType: (newType) => {
            const dmgs: Record<string, string> = {}
            dmgs[blast?.blastElement ?? ''] = newType
            const update = { flags: { pf2e: { damageSelections: dmgs } } }
            blast.damageSelections[blast?.blastElement ?? ''] = newType
            return updateActorItem(actor as Ref<CharacterPF2e>, blast.blastItemId ?? '', update)
          }
        }) as ElementalBlast
    )
  )
  type RuleWithOption = { option?: string; selection?: string }
  const blastActions = computed({
    get: () => {
      const blastItemId = actor.value?.elementalBlasts?.item?._id
      const rule = actor.value?.items
        ?.find((i) => i._id === blastItemId)
        ?.system?.rules?.find((r) => (r as RuleWithOption).option === 'action-cost')
      return (rule as RuleWithOption | undefined)?.selection
    },
    set: (newValue) => {
      const blastItemId = actor.value?.elementalBlasts?.item?._id
      const rules = actor.value?.items?.find((i) => i._id === blastItemId)?.system?.rules
      const actionRule = rules?.find((r) => (r as RuleWithOption).option === 'action-cost') as
        | RuleWithOption
        | undefined
      if (actionRule) actionRule.selection = newValue ?? ''
      const update = { system: { rules: rules } }
      return updateActorItem(actor as Ref<CharacterPF2e>, blastItemId ?? '', update)
    }
  })

  return {
    strikes,
    blasts,
    blastActions
  }
}
