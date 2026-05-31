// Structural types for the PF2e strike-action runtime objects living on
// actor.system.actions. Shared between the strike-related check handlers and
// getStrikeDamage.

export type StrikeRollFn = (opts: object) => Promise<unknown>

export type StrikeActionRuntime = {
  slug: string
  item: { dealsDamage: boolean } | null
  altUsages?: StrikeActionRuntime[]
  variants: { label: string; roll: StrikeRollFn }[]
  damage: StrikeRollFn
  critical: StrikeRollFn
}
