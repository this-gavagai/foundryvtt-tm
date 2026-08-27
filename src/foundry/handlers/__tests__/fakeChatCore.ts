// Test doubles for the two core chat APIs the chat handler now delegates to.
//
// Both are faithful copies of Foundry v14.367 so the tests exercise the real
// contract rather than a convenient approximation — in particular the whisper
// regex's CAPTURE GROUP LAYOUT, which is what the handler's parse code indexes
// into and the one thing it could get quietly wrong.
//
// Copied rather than imported because core ships as a client-side global inside
// the Foundry application bundle, with no importable package.

export type FakeUser = { id?: string | null; name?: string | null; isGM?: boolean }

// ── ChatLog.CHAT_COMMANDS, verbatim for the commands the handler recognizes ──
// client/applications/sidebar/tabs/chat.mjs. `any` is core's own "([^]*)".
const any = '([^]*)'
const CHAT_COMMANDS: Record<string, RegExp> = {
  // Roll commands come first in core's iteration order, so a `/r ...` message
  // must not be mistaken for a whisper. Included for exactly that ordering.
  roll: new RegExp(`^(\\/r(?:oll)? )([^#]+)(?:#(.*))?$`, 'i'),
  gmroll: new RegExp(`^(\\/gmr(?:oll)? )([^#]+)(?:#(.*))?$`, 'i'),
  ooc: new RegExp(`^(/ooc )${any}`, 'i'),
  emote: new RegExp(`^(/(?:em(?:ote)?|me) )${any}`, 'i'),
  gm: new RegExp(`^(/gm )${any}`, 'i'),
  whisper: new RegExp(/^(\/w(?:hisper)?\s)(\[[^\]]+]|\S+)\s*([^]*)/, 'i'),
  players: new RegExp(`^(/players )${any}`, 'i')
}

// ChatLog.parse, reduced to the single-line path the handler uses. Core also
// handles multiline roll commands (returning an array of matches) and returns a
// third element; neither affects what the handler reads.
export function fakeChatLogParse(message: string): [string, (string | RegExpMatchArray)[]] {
  const html = message.replace(/^<p>|<\/p>$/gi, '')
  for (const [rule, rgx] of Object.entries(CHAT_COMMANDS)) {
    const match = html.match(rgx)
    if (match) return [rule, match as unknown as string[]]
  }
  const invalid = html.match(/^(\/\S+)/)
  if (invalid) return ['invalid', invalid as unknown as string[]]
  return ['none', [message, '', message]]
}

// ChatMessage.getWhisperRecipients: keywords, then users by name, then users by
// the name of their ASSIGNED CHARACTER — the last of which is the capability the
// handler gained by delegating here. `characterOf` maps user id → assigned
// character name, so a test can exercise that branch.
export function makeFakeGetWhisperRecipients(
  users: FakeUser[],
  characterOf: Record<string, string> = {}
) {
  return (name: string): FakeUser[] => {
    if (['GM', 'DM'].includes(name.toUpperCase())) return users.filter((u) => u.isGM)
    if (name.toLowerCase() === 'players') return users.filter((u) => !u.isGM)

    const lower = name.toLowerCase()
    const byName = users.filter((u) => u.name?.toLowerCase() === lower)
    if (byName.length) return byName
    return users.filter((u) => characterOf[u.id ?? '']?.toLowerCase() === lower)
  }
}
