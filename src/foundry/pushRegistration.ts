// Push registration + per-world identity on the Foundry (module) side.
//
// One relay serves every world. Each world auto-generates a random opaque
// worldPushId and a secret worldKey (world settings — Foundry only lets the GM
// write world settings) and provisions them to the relay (TOFU). The relay URL
// is a build constant, so there is nothing per-client to configure; the GM only
// flips "enable push" (off by default, since chat then leaves the table).
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
  user?: { isGM?: boolean }
}

// The single shared relay. Everyone running Tabula Mensa uses this instance.
export const PUSH_RELAY_URL = 'https://tablemate-push-relay.openinst.workers.dev'

export const PUSH_ENABLED_SETTING = 'pushEnabled'
export const PUSH_INCLUDE_BODY_SETTING = 'pushIncludeBody'
export const PUSH_SCOPE_SETTING = 'pushScope'
const PUSH_WORLD_ID_SETTING = 'pushWorldId' // auto-generated, hidden
const PUSH_WORLD_KEY_SETTING = 'pushWorldKey' // auto-generated, hidden

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
      'user only when a message is whispered to them or names their username. ' +
      '"All messages" notifies everyone who can see each message.',
    scope: 'world',
    config: true,
    type: String,
    choices: { mentions: 'Whispers & mentions', all: 'All messages' },
    default: 'mentions'
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

// The world's push config, or null if push is disabled or not yet provisioned.
// Shared by the mint handler and the chat-message notify trigger.
export function readPushConfig(): PushConfig | null {
  if (!readBool(PUSH_ENABLED_SETTING)) return null
  const worldId = readStr(PUSH_WORLD_ID_SETTING)
  const worldKey = readStr(PUSH_WORLD_KEY_SETTING)
  if (!worldId || !worldKey) return null
  return {
    relayUrl: PUSH_RELAY_URL,
    worldId,
    worldKey,
    includeBody: readBool(PUSH_INCLUDE_BODY_SETTING),
    scope: readStr(PUSH_SCOPE_SETTING) === 'all' ? 'all' : 'mentions'
  }
}

// GM-only: mint this world's random id + key if absent (world settings are
// GM-writable only), then provision them to the relay. Idempotent — safe to run
// on every load and whenever the enable toggle flips.
export async function ensureWorldPushIdentity(): Promise<void> {
  if (!game.user?.isGM || !readBool(PUSH_ENABLED_SETTING)) return
  let worldId = readStr(PUSH_WORLD_ID_SETTING)
  let worldKey = readStr(PUSH_WORLD_KEY_SETTING)
  if (!worldId) {
    worldId = crypto.randomUUID()
    await game.settings.set(MODULE_ID, PUSH_WORLD_ID_SETTING, worldId)
  }
  if (!worldKey) {
    worldKey = randomKeyHex()
    await game.settings.set(MODULE_ID, PUSH_WORLD_KEY_SETTING, worldKey)
  }
  try {
    await fetch(`${PUSH_RELAY_URL}/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ worldPushId: worldId, worldKey })
    })
  } catch (error) {
    logger.warn('TABLEMATE: push provision failed', error)
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
