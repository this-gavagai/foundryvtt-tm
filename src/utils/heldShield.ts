// The shield block PF2e copies onto a creature, derived from the actor's own
// items instead.
//
// `system.attributes.shield` is not stored: PF2e builds it in
// `adjustCreatureShieldData`, which is a straight copy off whichever shield the
// creature is holding —
//
//   shield.ac = item.system.acBonus
//   shield.hardness = item.system.hardness
//   shield.hp.max = item.system.hp.max
//   shield.brokenThreshold = Math.floor(item.system.hp.max / 2)
//
// — so it arrives with a character payload and is missing entirely from the
// world dump. Without it the sheet's whole shield readout is hidden (ShieldDisplay
// gates on `itemId`), which is why this exists: a sheet painted from source data
// alone should still show the shield its character is holding.
//
// ONE bound, and it is worth stating precisely. `hardness` and `hp.max` are the
// item's PREPARED values in PF2e — a reinforcing rune, a shield grade or an item
// alteration raises both, off content tables this deliberately does not carry
// (the same tables that put rune-adjusted level and price out of reach). Reading
// them from source therefore gives the shield's BASE numbers. For an ordinary
// shield that is exact; for a reinforced one it under-reports, which is the
// honest direction and still better than hiding the readout.
//
// `raised` is not here: it is not a property of the shield at all but of an
// active Raise a Shield effect, which the sheet already derives from the actor's
// effects (see ShieldDisplay).

export interface ShieldSource {
  _id?: string | null
  type?: string
  system?: {
    acBonus?: number
    hardness?: number
    hp?: { value?: number; max?: number }
    usage?: { value?: string }
    equipped?: { carryType?: string; handsHeld?: number }
  }
}

export interface HeldShield {
  itemId: string
  ac: number
  hardness: number
  hp: { value: number; max: number; brokenThreshold: number }
  broken: boolean
  destroyed: boolean
}

// How many hands the item's usage demands. PF2e derives this in
// `getUsageDetails`; only the held forms matter for a shield.
function handsRequired(usage: string | undefined): number {
  return usage === 'held-in-two-hands' ? 2 : 1
}

// PF2e's `isEquipped(usage, equipped)`, for the held case a shield is always in.
// A dropped shield is never equipped, and a held one counts only when the hands
// committed to it meet what its usage demands.
function isHeld(shield: ShieldSource): boolean {
  const equipped = shield.system?.equipped
  if (!equipped || equipped.carryType !== 'held') return false
  return (equipped.handsHeld ?? 0) >= handsRequired(shield.system?.usage?.value)
}

// PF2e's `CreaturePF2e#heldShield`: of the equipped shields, the best one, where
// "best" is decided by AC bonus, then remaining hit points, then hardness — and
// ties fall to the one already held. Reproduced rather than simplified to "the
// first": a character wielding two shields is unusual but the tie-break is what
// decides which one the sheet's readout is about.
export function heldShield(items: readonly ShieldSource[] | undefined): HeldShield | null {
  const shields = (items ?? []).filter((item) => item.type === 'shield' && isHeld(item))
  if (shields.length === 0) return null

  const best = shields.reduce((a, b) => {
    if (a === b) return a
    const ac = (a.system?.acBonus ?? 0) - (b.system?.acBonus ?? 0)
    if (ac !== 0) return ac > 0 ? a : b
    const hp = (a.system?.hp?.value ?? 0) - (b.system?.hp?.value ?? 0)
    if (hp !== 0) return hp > 0 ? a : b
    const hardness = (a.system?.hardness ?? 0) - (b.system?.hardness ?? 0)
    return hardness > 0 ? a : hardness < 0 ? b : a
  })

  const max = best.system?.hp?.max ?? 0
  const value = best.system?.hp?.value ?? 0
  const brokenThreshold = Math.floor(max / 2)
  // PF2e's own ShieldPF2e getters: both require a shield that HAS hit points, so
  // a shield with no max (a buckler entered without one) is neither.
  const destroyed = max > 0 && value <= 0
  return {
    itemId: best._id ?? '',
    ac: best.system?.acBonus ?? 0,
    hardness: best.system?.hardness ?? 0,
    hp: { value, max, brokenThreshold },
    destroyed,
    broken: max > 0 && !destroyed && value <= brokenThreshold
  }
}
