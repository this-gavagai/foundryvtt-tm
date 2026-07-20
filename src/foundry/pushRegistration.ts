// Push-registration support on the Foundry (module) side.
//
// The relay must never hand a push token to a client that can't prove which
// Foundry user it is. Foundry's socket can't authenticate the sender, but the
// module already knows the requester's (self-reported) userId, so the GM's
// client mints a short-lived HMAC token binding {worldId, userId} with the
// shared WORLD_PUSH_KEY. The relay verifies that signature on /register.
//
// The relay URL and key are CLIENT-scoped settings: they live only in the GM's
// browser and are never synced to players (a world-scoped setting would leak the
// key to every connected client). Only the elected GM client (the one the
// listener's iAmProxyOrFallbackGM gate lets through) answers the mint request.

import { MODULE_ID } from '@/api/protocol'
import type { AcknowledgementArgs, RegisterPushArgs } from '@/types/api-types'
import { makeAck } from './utils/foundry'

declare const game: {
  settings: {
    register: (scope: string, key: string, config: object) => void
    get: (scope: string, key: string) => unknown
  }
  world: { id: string }
}

export const PUSH_RELAY_URL_SETTING = 'pushRelayUrl'
export const PUSH_WORLD_KEY_SETTING = 'pushWorldKey'

// Reg tokens are valid for five minutes — long enough for the app to finish
// registering, short enough that a leaked token is useless later.
const REG_TOKEN_TTL_SECONDS = 300

// Raw English strings, matching the registerMenu / manualRollPolicy precedent
// (the module ships no Foundry lang files).
export function registerPushSettings() {
  game.settings.register(MODULE_ID, PUSH_RELAY_URL_SETTING, {
    name: 'Push relay URL',
    hint:
      'Base URL of the Tablemate push relay, e.g. ' +
      'https://tablemate-push-relay.<subdomain>.workers.dev . Set this on the GM ' +
      'browser that stays connected during play. Leave blank to disable push.',
    scope: 'client',
    config: true,
    type: String,
    default: ''
  })
  game.settings.register(MODULE_ID, PUSH_WORLD_KEY_SETTING, {
    name: 'Push relay key',
    hint:
      "Shared secret (the relay's WORLD_PUSH_KEY) that authorises push sends and " +
      'signs device registrations. Keep it private — it is stored only in this ' +
      'browser and never synced to players.',
    scope: 'client',
    config: true,
    type: String,
    default: ''
  })
}

function readSetting(key: string): string {
  try {
    return String(game.settings.get(MODULE_ID, key) ?? '').trim()
  } catch {
    return ''
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

// Mint base64url(payload).base64url(HMAC-SHA256(payload)) — the exact shape the
// relay's verifyRegToken() checks (it signs the utf-8 bytes of the payload's
// base64url string with the raw key bytes).
async function mintRegToken(
  payload: { worldId: string; userId: string; exp: number },
  key: string
): Promise<string> {
  const enc = new TextEncoder()
  const payloadB64 = base64UrlFromString(JSON.stringify(payload))
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(payloadB64))
  return `${payloadB64}.${base64UrlFromBytes(sig)}`
}

export async function foundryRegisterPush(
  args: RegisterPushArgs
): Promise<AcknowledgementArgs & { regToken: string; relayUrl: string }> {
  const relayUrl = readSetting(PUSH_RELAY_URL_SETTING).replace(/\/+$/, '')
  const worldKey = readSetting(PUSH_WORLD_KEY_SETTING)
  if (!relayUrl || !worldKey) {
    // Surfaces to the app as a rejected RPC (error ack) rather than a 30s hang.
    throw new Error('Tablemate push relay is not configured on the GM client')
  }
  const exp = Math.floor(Date.now() / 1000) + REG_TOKEN_TTL_SECONDS
  const regToken = await mintRegToken({ worldId: game.world.id, userId: args.userId, exp }, worldKey)
  return { ...makeAck(args), regToken, relayUrl }
}
