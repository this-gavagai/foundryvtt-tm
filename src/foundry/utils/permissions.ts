// Handler-level permission checks for the requesting (tablet) user.
//
// Handlers run on the GM's client with GM privileges, and Foundry's fromUuid /
// game.packs give the GM unrestricted access to every document and pack. Left
// unchecked, a player app could read GM-only packs, copy any document onto its
// sheet, or execute any world macro as the GM. These helpers re-impose the
// permission the requesting user would have had if they'd done the same thing
// through Foundry's own UI.
//
// args.userId is self-reported over the module channel and can't be
// authenticated (see foundry/listener.ts), so this is best-effort within
// Foundry's trust model — but it closes the "any player → any document/macro"
// escalation.

import type { GamePF2e, UserPF2e } from '@7h3laughingman/pf2e-types'

// CONST.DOCUMENT_OWNERSHIP_LEVELS
const LIMITED = 1
const OBSERVER = 2

type PermTestable = {
  testUserPermission?: (user: unknown, level: string | number) => boolean
  getUserLevel?: (user: unknown) => number | null
}

export function getRequestingUser(source: GamePF2e, userId: string): UserPF2e | undefined {
  return source.users.get(userId) as UserPF2e | undefined
}

// Whether `user` may at least observe a compendium pack, honouring its per-pack
// ownership configuration. Falls back permissively only on cores predating pack
// ownership, where no per-pack restriction could exist.
export function userCanObservePack(pack: unknown, user: UserPF2e): boolean {
  const p = pack as PermTestable
  if (typeof p.testUserPermission === 'function') return p.testUserPermission(user, 'OBSERVER')
  if (typeof p.getUserLevel === 'function') return (p.getUserLevel(user) ?? 0) >= OBSERVER
  return true
}

// The pack id embedded in a Compendium UUID
// (Compendium.<scope>.<pack>.<DocType>.<id>), or undefined when the uuid isn't a
// compendium reference. Non-compendium uuids are rejected outright: fromUuid on
// the GM client would otherwise resolve world documents and actor-embedded
// items, bypassing the requesting player's permissions entirely.
export function compendiumPackIdFromUuid(uuid: string): string | undefined {
  if (!uuid.startsWith('Compendium.')) return undefined
  const parts = uuid.split('.')
  return parts.length >= 3 ? `${parts[1]}.${parts[2]}` : undefined
}

// Whether `user` may execute this macro, mirroring Foundry's own Macro#canExecute
// (LIMITED permission, plus the trusted-player setting for script macros).
export function userCanRunMacro(macro: unknown, user: UserPF2e): boolean {
  const m = macro as PermTestable & { type?: string }
  const canUse =
    typeof m.testUserPermission === 'function' ? m.testUserPermission(user, LIMITED) : true
  if (!canUse) return false
  if (m.type === 'script') {
    return !!(user as unknown as { can?: (permission: string) => boolean }).can?.('MACRO_SCRIPT')
  }
  return true
}
