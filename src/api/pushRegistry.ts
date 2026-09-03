import { logger } from '@/utils/utilities'

// What this device last registered with the push relay, per Foundry origin.
//
// Registrations live relay-side under (worldPushId, userId), neither of which the
// app knows on its own — the world id is minted inside the Foundry module and
// only ever reaches us in the /register response. Persisting that response here
// means a later "forget this server", or a switch to a different Foundry user,
// can undo the registration it created *without* a live connection to the world
// (which is exactly what we no longer have by then). Without it the only cleanup
// is the relay's 30-day stale prune, so a deleted server keeps pushing for a
// month.
//
// Keyed by origin because that is the identity the rest of the app deletes by
// (see serverAddress.removeServer and its sibling per-origin cache clears).

const STORAGE_KEY = 'tablemate.pushRegistrations'

export interface PushRegistrationRecord {
  relayUrl: string
  worldId: string
  userId: string
  deviceToken: string
}

type RecordMap = Record<string, PushRegistrationRecord>

function isRecord(value: unknown): value is PushRegistrationRecord {
  const r = value as PushRegistrationRecord | null
  return (
    typeof r?.relayUrl === 'string' &&
    typeof r.worldId === 'string' &&
    typeof r.userId === 'string' &&
    typeof r.deviceToken === 'string'
  )
}

function readAll(): RecordMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: RecordMap = {}
    for (const [origin, value] of Object.entries(parsed)) if (isRecord(value)) out[origin] = value
    return out
  } catch {
    // Corrupt entry — start fresh rather than blocking registration forever.
    return {}
  }
}

function writeAll(map: RecordMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch (err) {
    logger.warn('[push] could not persist registration record:', err)
  }
}

function sameRegistration(a: PushRegistrationRecord, b: PushRegistrationRecord): boolean {
  return a.worldId === b.worldId && a.userId === b.userId && a.deviceToken === b.deviceToken
}

// One relay registration can back several origins: the same world saved twice in
// the app (LAN address and remote address) registers the same (world, user,
// device), which the relay dedupes into a single entry. Forgetting one of those
// origins must not unregister the entry the other is still relying on — it would
// go quiet with nothing to prompt a re-register. Checked against the map *after*
// the caller's own edit, so the record's remaining holders are what's counted.
function stillHeldByAnotherOrigin(all: RecordMap, record: PushRegistrationRecord): boolean {
  return Object.values(all).some((other) => sameRegistration(other, record))
}

// Tell the relay to stop pushing to this device for this (world, user). Fire and
// forget: the relay prunes stale registrations anyway, so a failure here costs a
// few unwanted notifications, never correctness.
async function unregister(record: PushRegistrationRecord): Promise<void> {
  try {
    const res = await fetch(`${record.relayUrl}/unregister`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worldId: record.worldId,
        userId: record.userId,
        deviceToken: record.deviceToken
      })
    })
    if (!res.ok) logger.warn('[push] relay /unregister failed:', res.status)
  } catch (err) {
    logger.warn(
      '[push] relay /unregister skipped:',
      err instanceof Error ? err.message : String(err)
    )
  }
}

// Record a successful registration, superseding whatever this origin held
// before. A *different* (world, user, token) for the same origin means the old
// one is now wrong — a re-login as another Foundry user, or a rotated device
// token — so it is unregistered rather than left to linger for 30 days.
export function recordPushRegistration(origin: string, record: PushRegistrationRecord): void {
  if (!origin) return
  const all = readAll()
  const previous = all[origin]
  all[origin] = record
  writeAll(all)
  if (previous && !sameRegistration(previous, record) && !stillHeldByAnotherOrigin(all, previous)) {
    void unregister(previous)
  }
}

// Undo this device's registration for a server the app is forgetting.
export function forgetPushRegistration(origin: string): void {
  if (!origin) return
  const all = readAll()
  const record = all[origin]
  if (!record) return
  delete all[origin]
  writeAll(all)
  if (!stillHeldByAnotherOrigin(all, record)) void unregister(record)
}
