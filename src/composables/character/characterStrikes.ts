import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Field, WritableField } from './helpers'
import { type Strike, makeStrike, type ElementalBlast, makeElementalBlasts } from './defs/strike'
import { rollCheck, getStrikeDamage, setWeaponLoaded, toggleKineticAura } from '@/api/actions'
import { updateActorItem } from '@/api/documents'
import type { CharacterStrike, DamageType, WeaponPF2e } from '@7h3laughingman/pf2e-types'

export interface CharacterStrikes {
  strikes: Field<Strike[]>
  blasts: Field<ElementalBlast[]>
  blastActions: WritableField<string>
  kineticAuraActive: Field<boolean>
  toggleKineticAura: () => Promise<unknown>
}

export function useCharacterStrikes(actor: Ref<TablemateCharacter | undefined>): CharacterStrikes {
  const strikes = computed(() => {
    return (actor.value?.system?.actions as CharacterStrike[] | undefined)?.map((action) => {
      const weaponItem = actor.value?.items.find<WeaponPF2e<CharacterPF2e>>(
        (i) => i.system?.slug === action?.slug
      )
      const weaponId = weaponItem?._id ?? action?.item?._id ?? undefined
      // PF2e populates the strike's ammunition data from the weapon's loaded
      // subitems, so reloadable/loaded come straight from it.
      const reloadable = !!action?.ammunition?.requiresReload
      const loaded = (action?.ammunition?.loaded?.length ?? 0) > 0
      const reloadActions = weaponItem?.system?.reload?.value ?? undefined
      // Effective ammo: the last-used choice (selectedAmmoId, persisted on the
      // weapon), else default to the compatible ammo with the most in inventory.
      const compatible = action?.ammunition?.compatible ?? []
      const qtyOf = (id: string) =>
        (actor.value?.items.find((i) => i._id === id)?.system as { quantity?: number } | undefined)
          ?.quantity ?? 0
      const persisted = (action as { selectedAmmoId?: string | null })?.selectedAmmoId
      const effectiveAmmoId =
        persisted && compatible.some((c) => c.id === persisted)
          ? persisted
          : compatible.length
            ? [...compatible].sort((a, b) => qtyOf(b.id) - qtyOf(a.id))[0].id
            : undefined
      const base = makeStrike(action, weaponItem)
      return {
        ...base,
        reloadable,
        loaded,
        reloadActions,
        ammunition: base?.ammunition
          ? { ...base.ammunition, selected: { id: effectiveAmmoId ?? '' } }
          : base?.ammunition,
        setLoaded: (load: boolean) => {
          if (load && !effectiveAmmoId) return Promise.resolve(null)
          // Optimistic update: mutate the reactive actor object immediately so
          // the UI reflects the new state without waiting for a full refresh.
          const ammoData = action?.ammunition as { loaded?: unknown[] } | undefined
          if (ammoData) ammoData.loaded = load ? [{}] : []
          return weaponId
            ? setWeaponLoaded(
                actor as Ref<CharacterPF2e>,
                weaponId,
                load,
                load ? effectiveAmmoId : null
              )
            : Promise.resolve(null)
        },
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
        doDamage: (variant, altUsage, _blastOptions, result) =>
          rollCheck(
            actor as Ref<CharacterPF2e>,
            'damage',
            `${action.slug},${variant ? 'critical' : 'damage'},${altUsage ?? ''}`,
            result ?? {}
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
          if (actorAction)
            (actorAction as { selectedAmmoId?: string | null }).selectedAmmoId = newId || null

          const persistAmmoId =
            updateActorItem(actor as Ref<CharacterPF2e>, action?.item?._id ?? '', {
              system: { selectedAmmoId: newId || null }
            }) ?? Promise.resolve(null)

          if (!loaded || !weaponId) return persistAmmoId

          // Weapon is loaded — unload so the new ammo selection stays in sync.
          const ammoData = action?.ammunition as { loaded?: unknown[] } | undefined
          if (ammoData) ammoData.loaded = []
          return Promise.all([
            persistAmmoId,
            setWeaponLoaded(actor as Ref<CharacterPF2e>, weaponId, false, null)
          ])
        }
      } as Strike
    })
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
          doDamage: (variant, altUsage, blastOptions, result) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'blastDamage',
              `${blastOptions?.element},${blastOptions?.damageType},${variant ? 'criticalSuccess' : 'success'},${blastOptions?.isMelee}`,
              result ?? {}
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

  type ItemWithSlug = { system?: { slug?: string } }
  const hasAura = (i: ItemWithSlug) => i.system?.slug === 'effect-kinetic-aura'

  const kineticAuraActive = computed(
    () => (actor.value?.items as ItemWithSlug[] | undefined)?.some(hasAura) ?? false
  )

  const doToggleKineticAura = () => {
    // Optimistic update so the button flips immediately.
    const items = actor.value?.items as ItemWithSlug[] | undefined
    if (items) {
      if (kineticAuraActive.value) {
        const idx = items.findIndex(hasAura)
        if (idx >= 0) items.splice(idx, 1)
      } else {
        items.push({ system: { slug: 'effect-kinetic-aura' } })
      }
    }
    return toggleKineticAura(actor as Ref<CharacterPF2e>)
  }

  return {
    strikes,
    blasts,
    blastActions,
    kineticAuraActive,
    toggleKineticAura: doToggleKineticAura
  }
}
