// Push registration + per-world identity on the Foundry (module) side.
//
// One shared relay serves every world by default, so there is nothing a GM must
// configure beyond flipping "enable push" (off by default, since chat then leaves
// the table); a self-hoster can point PUSH_RELAY_URL_SETTING at their own. Each
// world auto-generates a random opaque worldPushId and a secret worldKey (world
// settings — Foundry only lets the GM write world settings) and provisions them
// to the relay (TOFU).
//
// The worldKey signs short-lived registration tokens binding {worldPushId,
// userId}, so the relay can trust a device belongs to a user without being able
// to verify Foundry sessions itself. The key is readable by world members (like
// any world setting) but not by outsiders — the same trust boundary Foundry
// uses. Bodies are a separate GM opt-in, decided in pushNotify.ts.

import { MODULE_ID } from '@/api/protocol'
import type { AcknowledgementArgs, RegisterPushArgs } from '@/types/api-types'
import { logger } from '@/utils/utilities'
import { makeAck } from './utils/foundry'

declare const game: {
  settings: {
    register: (scope: string, key: string, config: object) => void
    get: (scope: string, key: string) => unknown
    set: (scope: string, key: string, value: unknown) => Promise<unknown>
  }
  user?: { id?: string; isGM?: boolean }
  users?: { activeGM?: { id?: string } | null }
  world?: { id?: string }
}

// The single shared relay. Everyone running Tabula Mensa uses this instance.
export const PUSH_RELAY_URL = 'https://tablemate-push-relay.openinst.workers.dev'

export const PUSH_ENABLED_SETTING = 'pushEnabled'
export const PUSH_INCLUDE_BODY_SETTING = 'pushIncludeBody'
export const PUSH_SCOPE_SETTING = 'pushScope'
export const PUSH_RELAY_URL_SETTING = 'pushRelayUrl'
const PUSH_WORLD_ID_SETTING = 'pushWorldId' // auto-generated, hidden
const PUSH_WORLD_KEY_SETTING = 'pushWorldKey' // auto-generated, hidden
// Which Foundry world the identity above was minted for — see ensureWorldPushIdentity.
const PUSH_WORLD_ORIGIN_SETTING = 'pushWorldOrigin' // auto-generated, hidden

export type PushScope = 'mentions' | 'all'

const REG_TOKEN_TTL_SECONDS = 300

export function registerPushSettings() {
  game.settings.register(MODULE_ID, PUSH_ENABLED_SETTING, {
    name: 'Enable push notifications',
    hint:
      'Send a push notification to connected Tabula Mensa apps when a chat ' +
      'message arrives. Chat is relayed through the Tabula Mensa push service ' +
      'and Apple/Google to reach devices — leave off if you would rather no ' +
      'chat data leave your table.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => void ensureWorldPushIdentity()
  })
  game.settings.register(MODULE_ID, PUSH_INCLUDE_BODY_SETTING, {
    name: 'Include message text in push notifications',
    hint:
      'When on, notifications show the message text; when off (default), they ' +
      'show only who sent it. With this off, message text is never sent to the ' +
      'relay at all.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  })
  game.settings.register(MODULE_ID, PUSH_SCOPE_SETTING, {
    name: 'Notify on',
    hint:
      'Which messages trigger a push. "Whispers & mentions" (default) notifies a ' +
      'user only when a message is whispered to them or names their username with ' +
      'an @ (for example "@Alice"). "All messages" notifies everyone who can see ' +
      'each message.',
    scope: 'world',
    config: true,
    type: String,
    choices: { mentions: 'Whispers & mentions', all: 'All messages' },
    default: 'mentions'
  })
  game.settings.register(MODULE_ID, PUSH_RELAY_URL_SETTING, {
    name: 'Push relay URL',
    hint:
      'The service that forwards notifications to Apple/Google. Leave as the ' +
      'default unless you run your own relay (see the relay/ folder in the ' +
      'Tabula Mensa repository). Changing this re-provisions the world on the new ' +
      'relay; devices re-register themselves next time the app comes to the front.',
    scope: 'world',
    config: true,
    type: String,
    default: PUSH_RELAY_URL,
    onChange: () => void ensureWorldPushIdentity()
  })
  // Auto-generated, not shown in the settings UI.
  game.settings.register(MODULE_ID, PUSH_WORLD_ID_SETTING, {
    scope: 'world',
    config: false,
    type: String,
    default: ''
  })
  game.settings.register(MODULE_ID, PUSH_WORLD_KEY_SETTING, {
    scope: 'world',
    config: false,
    type: String,
    default: ''
  })
  game.settings.register(MODULE_ID, PUSH_WORLD_ORIGIN_SETTING, {
    scope: 'world',
    config: false,
    type: String,
    default: ''
  })
}

function readStr(key: string): string {
  try {
    return String(game.settings.get(MODULE_ID, key) ?? '').trim()
  } catch {
    return ''
  }
}

function readBool(key: string): boolean {
  try {
    return game.settings.get(MODULE_ID, key) === true
  } catch {
    return false
  }
}

function randomKeyHex(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface PushConfig {
  relayUrl: string
  worldId: string
  worldKey: string
  includeBody: boolean
  scope: PushScope
}

// The relay this world talks to: the GM's setting when it is a usable http(s)
// URL, otherwise the shared default. Trailing slashes are trimmed so callers can
// append paths without doubling up.
export function relayUrl(): string {
  const configured = readStr(PUSH_RELAY_URL_SETTING)
  if (!/^https?:\/\//i.test(configured)) return PUSH_RELAY_URL
  return configured.replace(/\/+$/, '')
}

// The world's push config, or null if push is disabled or not yet provisioned.
// Shared by the mint handler and the chat-message notify trigger.
export function readPushConfig(): PushConfig | null {
  if (!readBool(PUSH_ENABLED_SETTING)) return null
  const worldId = readStr(PUSH_WORLD_ID_SETTING)
  const worldKey = readStr(PUSH_WORLD_KEY_SETTING)
  if (!worldId || !worldKey) return null
  return {
    relayUrl: relayUrl(),
    worldId,
    worldKey,
    includeBody: readBool(PUSH_INCLUDE_BODY_SETTING),
    scope: readStr(PUSH_SCOPE_SETTING) === 'all' ? 'all' : 'mentions'
  }
}

// The one GM client Foundry designates as primary. Used to elect a single writer
// for the world's push identity, and (in pushNotify) a single sender per message.
export function isPrimaryGM(): boolean {
  const activeGmId = game.users?.activeGM?.id
  return !!activeGmId && game.user?.id === activeGmId
}

// Coalesces overlapping calls on THIS client: the enable toggle and the relay-URL
// toggle both fire onChange, and setup runs it too, so without this a single
// change can have three mints racing each other's awaits.
let minting: Promise<void> | null = null

// GM-only: mint this world's random id + key if absent (world settings are
// GM-writable only), then provision them to the relay. Idempotent — safe to run
// on every load and whenever the enable toggle flips.
//
// Only the primary GM mints automatically. Two GMs loading the world together
// would otherwise both read an empty setting, both generate an identity, and
// both provision it: one becomes an orphan entry on the relay, and any device
// that registered against the loser in between is stranded. `force` is for the
// GM explicitly asking (the status panel), where there is no such race.
export async function ensureWorldPushIdentity(options: { force?: boolean } = {}): Promise<void> {
  if (!game.user?.isGM || !readBool(PUSH_ENABLED_SETTING)) return
  // Defer only when Foundry has actually designated a primary and it isn't us.
  // With no designation to read (an unsettled user list), deferring would leave
  // the world unprovisioned with nothing scheduled to retry it.
  if (!options.force && game.users?.activeGM && !isPrimaryGM()) return
  if (!minting) minting = mintAndProvision().finally(() => (minting = null))
  return minting
}

async function mintAndProvision(): Promise<void> {
  let worldId = readStr(PUSH_WORLD_ID_SETTING)
  let worldKey = readStr(PUSH_WORLD_KEY_SETTING)

  // The identity lives in world settings, so duplicating a world or restoring a
  // backup into a new one copies it — and then two different worlds notify the
  // same registrations with the same key, each able to read the other's. Stamp
  // the Foundry world the identity was minted for and re-mint when it no longer
  // matches, which makes the copy a tenant of its own.
  //
  // Devices then need to re-register against the new id: the app's foreground
  // heartbeat does that (see pushNotifications.ts), since neither the server
  // origin nor the user id it keys on changes when a world is duplicated in place.
  //
  // An identity minted before this stamp existed has no origin recorded; that is
  // not a mismatch, so it keeps its id and simply gets stamped below.
  const currentWorld = String(game.world?.id ?? '')
  const mintedFor = readStr(PUSH_WORLD_ORIGIN_SETTING)
  if (worldId && mintedFor && currentWorld && mintedFor !== currentWorld) {
    logger.info('TABLEMATE: push identity was minted for another world, re-minting')
    worldId = ''
    worldKey = ''
  }

  if (!worldId) {
    worldId = crypto.randomUUID()
    await game.settings.set(MODULE_ID, PUSH_WORLD_ID_SETTING, worldId)
  }
  if (!worldKey) {
    worldKey = randomKeyHex()
    await game.settings.set(MODULE_ID, PUSH_WORLD_KEY_SETTING, worldKey)
  }
  if (currentWorld && mintedFor !== currentWorld) {
    await game.settings.set(MODULE_ID, PUSH_WORLD_ORIGIN_SETTING, currentWorld)
  }

  const status = await provision(worldId, worldKey)
  // 409 means the relay holds a DIFFERENT key for this id — the world settings
  // and the relay have diverged (a partial restore, a hand-cleared key), and
  // every /notify under this identity will 401 forever. Nothing can recover the
  // old key, so the only repair is a new identity. Do it here rather than leave
  // push permanently and silently dead; devices re-register on their next
  // foreground heartbeat.
  if (status === 409) {
    logger.warn('TABLEMATE: relay holds another key for this push id — minting a fresh identity')
    worldId = crypto.randomUUID()
    worldKey = randomKeyHex()
    await game.settings.set(MODULE_ID, PUSH_WORLD_ID_SETTING, worldId)
    await game.settings.set(MODULE_ID, PUSH_WORLD_KEY_SETTING, worldKey)
    await provision(worldId, worldKey)
  }
}

// POST the world's identity to the relay. Returns the HTTP status, or 0 if the
// relay could not be reached at all. A non-OK answer used to be discarded, which
// is how a world could sit with push "enabled" and provisioning permanently
// broken while nothing anywhere said so.
async function provision(worldId: string, worldKey: string): Promise<number> {
  try {
    const res = await fetch(`${relayUrl()}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ worldPushId: worldId, worldKey })
    })
    if (!res.ok && res.status !== 409) {
      logger.warn('TABLEMATE: push provision rejected', res.status, await res.text().catch(() => ''))
    }
    return res.status
  } catch (error) {
    logger.warn('TABLEMATE: push provision failed', error)
    return 0
  }
}

function base64UrlFromString(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlFromBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// base64url(payload).base64url(HMAC-SHA256(payload)) — the shape the relay's
// verifyRegToken() checks.
async function mintRegToken(payload: { worldId: string; userId: string; exp: number }, key: string): Promise<string> {
  const enc = new TextEncoder()
  const payloadB64 = base64UrlFromString(JSON.stringify(payload))
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(payloadB64))
  return `${payloadB64}.${base64UrlFromBytes(sig)}`
}

export async function foundryRegisterPush(
  args: RegisterPushArgs
): Promise<AcknowledgementArgs & { regToken: string; relayUrl: string }> {
  const config = readPushConfig()
  if (!config) {
    // Rejected RPC (error ack) rather than a 30s hang — push is off/unprovisioned.
    throw new Error('Tabula Mensa push is not enabled for this world')
  }
  const exp = Math.floor(Date.now() / 1000) + REG_TOKEN_TTL_SECONDS
  const regToken = await mintRegToken({ worldId: config.worldId, userId: args.userId, exp }, config.worldKey)
  return { ...makeAck(args), regToken, relayUrl: config.relayUrl }
}
