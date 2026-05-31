import type {
  ActorPF2e,
  DamageType,
  ItemPF2e,
  PhysicalItemPF2e,
  WeaponPF2e
} from '@7h3laughingman/pf2e-types'
import type {
  SetWeaponDamageTypeArgs,
  SetWeaponLoadedArgs,
  ToggleKineticAuraArgs
} from '@/types/api-types'
import { getGame, makeAck } from '../utils/foundry'

export async function foundryToggleKineticAura(args: ToggleKineticAuraArgs) {
  const KINETIC_AURA_EFFECT_UUID = 'Compendium.pf2e.feat-effects.Item.pLurcSPQb2gjAzoP'
  const KINETIC_AURA_DEFAULT_RADIUS = 10
  const source = getGame()
  const ack = makeAck(args)
  const actor = source.actors.get(args.characterId, { strict: true })
  const existingAura = actor.items.find((i: ItemPF2e) => i.slug === 'effect-kinetic-aura')
  if (existingAura) {
    await existingAura.delete()
  } else {
    // Fetch the effect from compendium and pre-set the ChoiceSet selection so
    // PF2e skips the aura-radius dialog and uses the default 10ft radius.
    const effectDoc = await fromUuid(KINETIC_AURA_EFFECT_UUID)
    if (effectDoc) {
      type RuleData = { key: string; selection?: number }
      const effectData = (effectDoc as ItemPF2e).toObject()
      const choiceSet = (effectData.system.rules as RuleData[]).find((r) => r.key === 'ChoiceSet')
      if (choiceSet) choiceSet.selection = KINETIC_AURA_DEFAULT_RADIUS
      await actor.createEmbeddedDocuments('Item', [effectData])
    }
  }
  return ack
}

// weapon's selected ammo; unloading detaches whatever is currently loaded.
export async function foundrySetWeaponLoaded(args: SetWeaponLoadedArgs) {
  const source = getGame()
  const ack = makeAck(args)

  const actor = source.actors.get(args.characterId, { strict: true })
  const weapon = actor.items.get(args.weaponId, { strict: true }) as WeaponPF2e<ActorPF2e<null>>
  const loadedAmmo = weapon.subitems.filter(
    (i: PhysicalItemPF2e) =>
      i.isOfType('ammo') || (i.isOfType('weapon') && (i as WeaponPF2e).isAmmoFor(weapon))
  )

  if (args.loaded) {
    // Only load the explicitly-chosen ammo (no automatic fallback).
    const ammo = args.ammoId ? actor.inventory.get(args.ammoId) : undefined
    const capacity = (weapon.system.ammo as { capacity?: number } | null)?.capacity ?? 1
    const numLoaded = loadedAmmo.reduce((sum, a) => sum + (a.quantity ?? 0), 0)
    if (ammo && capacity - numLoaded > 0) {
      await weapon.attach(ammo, { quantity: 1, stack: true })
    }
  } else {
    for (const sub of loadedAmmo) await sub.detach({ skipConfirm: true })
  }
  return ack
}

export async function foundrySetWeaponDamageType(args: SetWeaponDamageTypeArgs) {
  const source = getGame()
  const ack = makeAck(args)
  const actor = source.actors.get(args.characterId, { strict: true })
  const weapon = actor.items.get(args.weaponId, { strict: true }) as WeaponPF2e<ActorPF2e<null>>
  // Versatile takes a DamageType string; modular takes an index into
  // its options array (each option's damageType is the candidate type).
  if (args.trait === 'modular') {
    const options = weapon.system.traits.toggles.modular?.options ?? []
    const idx =
      args.selected === null ? null : options.findIndex((o) => o.damageType === args.selected)
    await weapon.system.traits.toggles.update({
      trait: 'modular',
      selected: idx === -1 ? null : idx
    })
  } else {
    await weapon.system.traits.toggles.update({
      trait: 'versatile',
      selected: args.selected as DamageType | null
    })
  }
  return ack
}
