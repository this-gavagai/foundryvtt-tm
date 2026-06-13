import { computed, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { TablemateCharacter } from '@/types/character-types'
import type { Field, WritableField } from './helpers'
import { type Strike, makeStrike, type ElementalBlast, makeElementalBlasts } from './defs/strikeDef'
import {
  rollCheck,
  getStrikeDamage,
  setWeaponLoaded,
  setWeaponDamageType,
  toggleKineticAura
} from '@/api/actionRpc'
import { updateActorItem } from '@/api/documents'
import type { CharacterStrike, DamageType, WeaponPF2e } from '@7h3laughingman/pf2e-types'

export interface CharacterStrikes {
  strikes: Field<Strike[]>
  blasts: Field<ElementalBlast[]>
  blastActions: WritableField<string>
  setBlastActions: (value: string) => Promise<unknown> | undefined
  kineticAuraActive: Field<boolean>
  toggleKineticAura: () => Promise<unknown>
}

export function useCharacterStrikes(actor: Ref<TablemateCharacter | undefined>): CharacterStrikes {
  const strikes = computed(() => {
    return (actor.value?.system?.actions as CharacterStrike[] | undefined)?.map((action) => {
      // Match by slug first; for granted items (e.g. clan dagger from the
      // ancestry feat) PF2e gives the actor-item a unique slug that differs
      // from the strike's slug, so fall back to the strike's own item _id.
      // If that lookup lands on the granting feat itself (PF2e references the
      // feat as the strike's item when the weapon was granted by it), chase
      // the feat's itemGrants to the actual weapon — that's the one with the
      // versatile/modular traits and damageType the picker needs.
      let weaponItem: WeaponPF2e<CharacterPF2e> | undefined =
        actor.value?.items.find<WeaponPF2e<CharacterPF2e>>(
          (i) => i.system?.slug === action?.slug && i.type === 'weapon'
        ) ??
        actor.value?.items.find<WeaponPF2e<CharacterPF2e>>(
          (i) => i._id === action?.item?._id && i.type === 'weapon'
        )
      if (!weaponItem) {
        const granter = actor.value?.items.find(
          (i) => i._id === action?.item?._id || i.system?.slug === action?.slug
        ) as { itemGrants?: string[] } | undefined
        for (const gid of granter?.itemGrants ?? []) {
          const found = actor.value?.items.find((i) => i._id === gid && i.type === 'weapon')
          if (found) {
            weaponItem = found as WeaponPF2e<CharacterPF2e>
            break
          }
        }
      }
      const weaponId = weaponItem?._id ?? action?.item?._id ?? undefined
      // PF2e populates the strike's ammunition data from the weapon's loaded
      // subitems, so reloadable/loaded come straight from it.
      const reloadable = !!action?.ammunition?.requiresReload
      // "Loaded" means there's actually usable ammo in the weapon, not merely a
      // loaded entry present: after firing a magazine-fed weapon dry, PF2e keeps
      // the spent magazine attached (quantity/uses 0) rather than detaching it,
      // so a plain length check would leave the weapon stuck showing as loaded.
      const loaded = (action?.ammunition?.loaded ?? []).some((l) => (l.quantity ?? 0) > 0)
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
      // Track any in-flight damage-type toggle update so doDamage can wait for
      // it before firing — prevents the roll from reaching Foundry before the
      // actor has been re-derived with the new toggle value.
      let pendingToggle: Promise<unknown> | null = null
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
          const ammoData = action?.ammunition as { loaded?: { quantity?: number }[] } | undefined
          if (ammoData) ammoData.loaded = load ? [{ quantity: 1 }] : []
          return weaponId
            ? setWeaponLoaded(
                actor as Ref<CharacterPF2e>,
                weaponId,
                load,
                load ? effectiveAmmoId : null
              )
            : Promise.resolve(null)
        },
        getDamage: (
          altUsage = undefined,
          _blastOptions = undefined,
          modifierOverrides = undefined
        ) => getStrikeDamage(actor as Ref<CharacterPF2e>, action.slug, altUsage, modifierOverrides),
        doStrike: (variant, altUsage, blastOptions, result, modifierOverrides) =>
          rollCheck(
            actor as Ref<CharacterPF2e>,
            'strike',
            `${action.slug},${variant},${altUsage ?? ''}`,
            { d20: [result ?? 0] },
            [],
            modifierOverrides ? { modifierOverrides } : {}
          ),
        doDamage: (variant, altUsage, _blastOptions, result, modifierOverrides) => {
          const doRoll = () =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'damage',
              `${action.slug},${variant ? 'critical' : 'damage'},${altUsage ?? ''}`,
              result ?? {},
              [],
              modifierOverrides ? { modifierOverrides } : {}
            )
          return pendingToggle ? pendingToggle.then(doRoll) : doRoll()
        },
        setDamageType: (newType) => {
          if (!actor.value || !weaponId) return Promise.resolve(null)
          const item = actor.value.items.find<WeaponPF2e<CharacterPF2e>>((i) => i._id === weaponId)
          const isModular = item?.system?.traits?.value?.includes('modular' as never)
          const trait = isModular ? 'modular' : 'versatile'
          const baseDamageType = item?.system?.damage?.damageType
          const selected = baseDamageType === newType ? null : newType
          // Optimistic local update so the UI flips immediately. Versatile
          // stores the selection on the toggle as a damage type string;
          // modular stores an index there, but the picker reads from the
          // prepared system.damage.damageType, so mirror it there instead.
          // For the "revert to base" path (selected === null) we let Foundry's
          // response reset it, since we don't track the source base here.
          const toggles = item?.system?.traits?.toggles
          if (isModular) {
            if (selected !== null && item?.system?.damage) {
              item.system.damage.damageType = selected as DamageType
            }
          } else if (toggles?.versatile) {
            toggles.versatile.selected = selected as DamageType | null
          }
          pendingToggle = setWeaponDamageType(
            actor as Ref<CharacterPF2e>,
            weaponId,
            trait,
            selected
          )
          pendingToggle.finally(() => {
            pendingToggle = null
          })
          return pendingToggle
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
          const ammoData = action?.ammunition as { loaded?: { quantity?: number }[] } | undefined
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
          getDamage: (altUsage, blastOptions, modifierOverrides) =>
            getStrikeDamage(
              actor as Ref<CharacterPF2e>,
              `blast:${blastOptions?.element},${blastOptions?.damageType},${blastOptions?.isMelee}`,
              undefined,
              modifierOverrides
            ),
          doStrike: (variant, altUsage, blastOptions, result, modifierOverrides) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'blast',
              `${blastOptions?.element},${blastOptions?.damageType},${variant},${blastOptions?.isMelee}`,
              { d20: [result ?? 0] },
              [],
              modifierOverrides ? { modifierOverrides } : {}
            ),
          doDamage: (variant, altUsage, blastOptions, result, modifierOverrides) =>
            rollCheck(
              actor as Ref<CharacterPF2e>,
              'blastDamage',
              `${blastOptions?.element},${blastOptions?.damageType},${variant ? 'criticalSuccess' : 'success'},${blastOptions?.isMelee}`,
              result ?? {},
              [],
              modifierOverrides ? { modifierOverrides } : {}
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

  // Exposed as a named function so callers that need the returned promise can
  // chain further work (e.g. re-fetching the damage formula) after the item
  // update has been acknowledged by the server — avoiding the race where the
  // getDamage request arrives before the actor is re-derived with the new cost.
  function doSetBlastActions(newValue: string): Promise<unknown> | undefined {
    const blastItemId = actor.value?.elementalBlasts?.item?._id
    const rules = actor.value?.items?.find((i) => i._id === blastItemId)?.system?.rules
    const actionRule = rules?.find((r) => (r as RuleWithOption).option === 'action-cost') as
      | RuleWithOption
      | undefined
    if (actionRule) actionRule.selection = newValue
    if (!blastItemId) return undefined
    return updateActorItem(actor as Ref<CharacterPF2e>, blastItemId, { system: { rules } })
  }

  const blastActions = computed({
    get: () => {
      const blastItemId = actor.value?.elementalBlasts?.item?._id
      const rule = actor.value?.items
        ?.find((i) => i._id === blastItemId)
        ?.system?.rules?.find((r) => (r as RuleWithOption).option === 'action-cost')
      return (rule as RuleWithOption | undefined)?.selection
    },
    set: (newValue) => doSetBlastActions(newValue ?? '')
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
    setBlastActions: doSetBlastActions,
    kineticAuraActive,
    toggleKineticAura: doToggleKineticAura
  }
}
