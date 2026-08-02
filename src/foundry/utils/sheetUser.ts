// The `tablemate.character_sheet` User flag: this user's Foundry client loads
// the Tabula app instead of the standard Foundry environment (see the redirect
// in tablemate.ts). Set from the User Select menu.
//
// One predicate, shared, because the flag now means more than "redirect this
// browser". A GM may be a sheet user too, and a GM sitting in Tabula is NOT
// running a Foundry client at all — so they cannot be the elected request
// handler, and every client has to agree on that (gmHandlerSetting.ts). Reading
// the flag by hand in each of those places is how they'd drift apart.

export const SHEET_USER_FLAG = 'character_sheet'
export const SHEET_USER_VALUE = 'root'

// Both shapes the flag reaches us in: a User *document* (getFlag), and a plain
// source row out of `game.data.users` or a socket payload (flags). Documents
// have both; source rows only the second. `flags` is deliberately `unknown` —
// every caller's own User type declares its own flag record shape, and narrowing
// here would only make them all cast.
export interface SheetFlaggedUser {
  flags?: unknown
  getFlag?: (scope: string, key: string) => unknown
}

export function isSheetUser(user: SheetFlaggedUser | null | undefined): boolean {
  if (!user) return false
  const tablemate = (user.flags as { tablemate?: Record<string, unknown> } | undefined)?.tablemate
  const flagged = tablemate?.[SHEET_USER_FLAG]
  if (flagged !== undefined) return flagged === SHEET_USER_VALUE
  return user.getFlag?.('tablemate', SHEET_USER_FLAG) === SHEET_USER_VALUE
}
