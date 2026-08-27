import type {
  ChatRollRerollMode,
  RerollChatRollArgs,
  SendChatMessageArgs,
  SendImageArgs,
  SendVoiceMemoArgs
} from '@/types/api-types'
import type { GamePF2e } from '@7h3laughingman/pf2e-types'
import { withBackgroundRoll } from '../backgroundRoll'
import { registerCapture } from '../chatCapture'
import { extractRollPayload } from '../utils/roll'
import { actorSpeaker, getCharacter, getGame, makeAck } from '../utils/foundry'
import { voiceMemoEnabled, voiceMemoUploadPath } from '../voiceMemoSetting'
import { imageUploadEnabled, imageUploadPath } from '../imageUploadSetting'
import { makeChunkAccumulator } from './chunkedUpload'
import { chatMessageClass, getChatLog, getFilePicker, type FilePickerLike } from '../globals'
import { logger } from '@/utils/utilities'

// The created message document, narrowed to the id we hand back to the sender
// (which patches its own transcript onto the message; see below).
type CreatedChatMessage = { id?: string | null; _id?: string | null }

// The created message document, narrowed to the id we hand back to the sender.
interface WhisperUser {
  id?: string | null
  name?: string | null
  isGM?: boolean
  getFlag?: (scope: string, key: string) => unknown
}

type RerollKeep = 'new' | 'higher' | 'lower'

type RerollableChatMessage = {
  rolls?: Array<{ class?: string } | undefined>
  isRerollable?: boolean
  actor?: { _id?: string | null } | null
  speaker?: { actor?: string | null }
}

function rerollOptionsForMode(mode: ChatRollRerollMode): { resource?: string; keep?: RerollKeep } {
  switch (mode) {
    case 'hero-point':
      return { resource: 'hero-points', keep: 'new' }
    case 'keep-highest':
      return { keep: 'higher' }
    case 'keep-lowest':
      return { keep: 'lower' }
    case 'reroll':
    default:
      return { keep: 'new' }
  }
}

// Deliberately not foundry.utils.escapeHTML: that exists and is equivalent (bar
// &#x27; vs &#39; for the apostrophe), but it is a bare client global, so reaching
// for it makes every test that posts a message stub `foundry` — real coupling in
// exchange for deleting five lines of string replacement that cannot drift.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatChatContent(content: string): string {
  return escapeHtml(content.trim()).replace(/\n/g, '<br>')
}

// Recognize a whisper command in text typed on a tablet, using Foundry's own
// command parser rather than a private regex.
//
// ChatLog.parse is what the Foundry chat bar itself calls, so `/w`, `/whisper`,
// `/gm` and `/players` mean here exactly what they mean when typed into Foundry —
// including the details a re-implementation drifts on (a bracketed name with
// spaces, comma-separated names, where the recipient list ends and the body
// begins). Returns null for plain text and for the commands this handler doesn't
// implement (`/roll`, `/emote`, …), which are posted as literal text as before.
//
// Group layout per core's CHAT_COMMANDS: whisper captures the command, the target
// token and the body; /gm and /players capture the command and the body.
// Core's parse() returns one of two shapes under a single type — the capture
// groups of a single-line command, or one such array per line for a multiline
// roll — and Foundry's own declaration states the union as
// `(string | RegExpMatchArray)[]`, which describes both and distinguishes
// neither. A first element that is a string means the flat form: the whole match.
function isFlatMatch(match: (string | RegExpMatchArray)[]): match is RegExpMatchArray {
  return typeof match[0] === 'string'
}

function parseWhisperCommand(raw: string): { targets: string[]; content: string } | null {
  const chatLog = getChatLog()
  if (!chatLog) return null

  const [command, match] = chatLog.parse(raw)
  // Only the single-line whisper commands reach us as a flat match array; the
  // multiline roll commands parse to an array of matches, which we don't handle.
  if (!isFlatMatch(match)) return null
  const groups = match

  switch (command) {
    case 'whisper':
      // Core splits the captured target token on commas (see
      // ChatLog##processWhisperCommand), which is how `/w ana,bob hi` addresses
      // two people; resolveWhisperRecipients strips the brackets.
      return { targets: (groups[2] ?? '').split(','), content: groups[3] ?? '' }
    case 'gm':
      return { targets: ['gm'], content: groups[2] ?? '' }
    case 'players':
      return { targets: ['players'], content: groups[2] ?? '' }
    default:
      return null
  }
}

// Resolve whisper target names to Foundry user ids through core's own lookup.
//
// ChatMessage.getWhisperRecipients is the function the Foundry chat bar uses, so
// the keywords (`gm`/`dm`, `players`) and case-insensitive name matching behave
// identically — and it resolves a name that matches a user's assigned CHARACTER
// as well as their login name, which the hand-rolled version this replaces did
// not. Whispering to "Ezren" now finds Ezren's player.
function resolveWhisperRecipients(targets: string[]): string[] {
  const ids = new Set<string>()
  for (const target of targets) {
    // Brackets let a name contain spaces (`[Ana Vale]`); they aren't part of it.
    const name = target.replace(/[[\]]/g, '').trim()
    if (!name) continue
    for (const user of chatMessageClass().getWhisperRecipients(name)) {
      if (user?.id) ids.add(user.id)
    }
  }
  return [...ids]
}

// The name an out-of-character message speaks as: the requesting user's, unless
// their Tablemate `belongsTo` flag points at an owning login user (e.g. a
// sheet-only user attached to a human), in which case that user's name is used.
function outOfCharacterAlias(source: GamePF2e, userId: string): string | undefined {
  const users = source.users as { get?: (id: string) => WhisperUser | undefined }
  const user = users.get?.(userId)
  const owner = user?.getFlag?.('tablemate', 'belongsTo')
  if (typeof owner === 'string' && owner) {
    const ownerUser = users.get?.(owner)
    if (ownerUser?.name) return ownerUser.name
  }
  return user?.name ?? undefined
}

export async function foundrySendChatMessage(args: SendChatMessageArgs) {
  const source = getGame()
  const actor = source.actors.get(args.characterId, { strict: true })

  const whisper = parseWhisperCommand(args.content.trimStart())
  const content = formatChatContent(whisper ? whisper.content : args.content)
  if (!content) return makeAck(args)

  // Out-of-character messages speak as the player: keep the actor out of the
  // speaker so only the human's name shows, falling back to the actor speaker
  // if the user name can't be resolved.
  const oocAlias = args.outOfCharacter ? outOfCharacterAlias(source, args.userId) : undefined
  const speaker = oocAlias ? { alias: oocAlias } : actorSpeaker(actor)

  const data: Record<string, unknown> = {
    author: args.userId,
    speaker,
    content
  }

  if (whisper) {
    const recipients = resolveWhisperRecipients(whisper.targets)
    // An empty `whisper` array reads as a public message in Foundry, which would
    // leak a message the user meant to be private. When nothing resolves, scope
    // it to the author so it stays out of other players' overlays.
    data.whisper = recipients.length ? recipients : [args.userId]
  }

  await chatMessageClass().create(data)
  return makeAck(args)
}

// ── Chunked media uploads (voice memos + images) ─────────────────────────────
// A recorded clip / picked image arrives as a series of chunks sharing one
// uploadId (see SendVoiceMemoArgs / SendImageArgs). The shared accumulator
// (chunkedUpload.ts) buffers the decoded bytes until the final chunk lands, then
// runs the feature's finalize below to upload the file and post the chat
// message. Each chunk is its own RPC/ack; the app awaits each before the next.

// Upper bound on chunk count, so a stray/hostile request can't make us allocate
// a huge buffer array. A 5-minute low-bitrate memo (or a downscaled image) is a
// handful of 192 KiB chunks; a few thousand is far beyond any real upload.
const MEDIA_UPLOAD_MAX_CHUNKS = 4096

// How long to wait for the next chunk before giving an upload up (app closed
// mid-send, GM/proxy handoff, etc.) so a partial file can't leak memory. Per
// GAP, not per upload: comfortably longer than the app's 30s ack budget for a
// single chunk, so a slow chunk that is still coming is never mistaken for an
// app that went away — however many chunks the memo takes.
const MEDIA_UPLOAD_TTL_MS = 60_000

type VoiceMemoMeta = {
  userId: string
  characterId: string
  mimeType: string
  durationMs: number
  content?: string
  outOfCharacter?: boolean
  whisper?: string[]
  transcriptPending?: boolean
}

// What the final chunk's ack reports back to the sending app: the message the
// memo was posted as, and the content the module rendered for it. The app is
// the message's author, so it patches its own transcript onto that message
// directly over the socket once its transcription call returns — the module
// does no transcribing of its own (see api/transcription.ts on the app side).
type VoiceMemoResult = { messageId?: string; content?: string }

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav'
}

// Map a possibly-parameterized MIME ('audio/webm;codecs=opus') to a Foundry
// uploadable audio extension, defaulting to webm for anything unrecognized.
function audioExtension(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  return AUDIO_EXTENSIONS[base] ?? 'webm'
}

// FilePicker.createDirectory has no "mkdir -p", so create each missing level.
// We check existence with browse() first (it rejects for a missing directory)
// rather than parsing createDirectory's "already exists" error, whose wording
// varies across Foundry versions and storage backends. The createDirectory
// catch remains only as a race guard: two memos creating the same folder at
// once can both pass the browse check, and the loser must tolerate "exists".
async function ensureDirectory(picker: FilePickerLike, source: string, path: string) {
  let current = ''
  for (const segment of path.split('/')) {
    current = current ? `${current}/${segment}` : segment
    let exists = false
    try {
      await picker.browse(source, current, {})
      exists = true
    } catch {
      exists = false
    }
    if (exists) continue
    try {
      await picker.createDirectory(source, current, {})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/exist/i.test(message)) throw error
    }
  }
}

async function finalizeVoiceMemo(
  uploadId: string,
  parts: Uint8Array<ArrayBuffer>[],
  meta: VoiceMemoMeta
): Promise<VoiceMemoResult> {
  const source = getGame()
  const actor = source.actors.get(meta.characterId, { strict: true })

  // Destination is the GM-configured folder; refuse if it's since been cleared.
  const dir = voiceMemoUploadPath()
  if (!dir) throw new Error('Voice memo destination folder is not configured')

  const picker = getFilePicker()
  await ensureDirectory(picker, 'data', dir)

  // uploadId is a client-minted uuid; strip anything not filename-safe.
  const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '') || 'memo'
  const filename = `${safeId}.${audioExtension(meta.mimeType)}`
  const file = new File(parts, filename, { type: meta.mimeType })

  const result = await picker.upload('data', dir, file, {}, { notify: false })
  const audioPath = result && result.path
  if (!audioPath) throw new Error('Voice memo upload returned no path')

  const oocAlias = meta.outOfCharacter ? outOfCharacterAlias(source, meta.userId) : undefined
  const speaker = oocAlias ? { alias: oocAlias } : actorSpeaker(actor)

  // An <audio> element in the content lets Foundry's own chat log play the memo;
  // the Tablemate app ignores it (its sanitizer strips <audio>) and renders a
  // native player from the flag instead. Any caption is escaped and shown above.
  // The src is escaped too — the path is server-generated today, but escaping
  // keeps an unexpected character (e.g. a quote in the configured folder) from
  // breaking out of the attribute.
  const caption = meta.content ? formatChatContent(meta.content) : ''
  const player = `<audio controls preload="metadata" src="${escapeHtml(audioPath)}"></audio>`

  const content = caption ? `${caption}<br>${player}` : player

  const data: Record<string, unknown> = {
    author: meta.userId,
    speaker,
    content,
    flags: {
      tablemate: {
        audioPath,
        audioMimeType: meta.mimeType,
        audioDurationMs: meta.durationMs,
        // Set when the sending app is transcribing this memo and will patch the
        // text on shortly. Read only by the push notifier, which holds a memo's
        // notification briefly so it can carry the spoken words (pushNotify.ts).
        ...(meta.transcriptPending ? { transcriptPending: true } : {})
      }
    }
  }
  if (meta.whisper?.length) {
    // whisper carries the same command targets the text path sends ('gm' /
    // '[Name]'); resolve them with the shared logic. Mirror the text handler's
    // leak-guard: scope an unresolved private memo to its author rather than
    // letting an empty array read as a public message.
    const recipients = resolveWhisperRecipients(meta.whisper)
    data.whisper = recipients.length ? recipients : [meta.userId]
  }

  let message: CreatedChatMessage | undefined
  try {
    message = await chatMessageClass().create(data)
  } catch (error) {
    // The file uploaded but the message didn't post: surface the failure to the
    // app, and log the orphaned path so it can be reclaimed (Foundry exposes no
    // reliable file-delete here, so we don't attempt a fragile cleanup).
    logger.warn('TABLEMATE: voice memo uploaded but chat message failed', audioPath, error)
    throw error
  }

  // Hand the posted message back so the sender can patch its transcript onto it
  // (see VoiceMemoResult). `id` is the live document's accessor; `_id` covers a
  // plain-object stand-in.
  return { messageId: message?.id ?? message?._id ?? undefined, content }
}

const voiceMemoAccumulator = makeChunkAccumulator<VoiceMemoMeta, VoiceMemoResult>({
  label: 'Voice memo',
  maxChunks: MEDIA_UPLOAD_MAX_CHUNKS,
  ttlMs: MEDIA_UPLOAD_TTL_MS,
  finalize: finalizeVoiceMemo
})

export async function foundrySendVoiceMemo(args: SendVoiceMemoArgs) {
  // Feature gate: reject the first chunk outright when the world has no
  // destination configured, so nothing is buffered and the app surfaces the
  // refusal. The app already hides the mic in this case; this is defense in
  // depth against a stale or hand-crafted request.
  if (!voiceMemoEnabled()) throw new Error('Voice memos are not enabled for this world')

  const posted = await voiceMemoAccumulator.accept(
    { uploadId: args.uploadId, seq: args.seq, total: args.total, chunkBase64: args.chunkBase64 },
    {
      userId: args.userId,
      characterId: args.characterId,
      mimeType: args.mimeType,
      durationMs: args.durationMs,
      content: args.content,
      outOfCharacter: args.outOfCharacter,
      whisper: args.whisper,
      transcriptPending: args.transcriptPending
    }
  )
  // Only the final chunk has a posted message to report; the rest ack bare.
  return { ...makeAck(args), ...posted }
}

// ── Images ───────────────────────────────────────────────────────────────────
// An uploaded image arrives as SEND_IMAGE chunks (SendImageArgs), reassembled by
// the same accumulator as voice memos. On the final chunk we upload the file and
// post a ChatMessage with an <img> in the content (so Foundry's own chat log
// shows it) wrapped in a [data-tablemate-image] div the app strips — the app
// renders its own <img> from flags.tablemate.imagePath.

type ImageMeta = {
  userId: string
  characterId: string
  mimeType: string
  width?: number
  height?: number
  content?: string
  outOfCharacter?: boolean
  whisper?: string[]
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

// Map a possibly-parameterized MIME to a Foundry uploadable image extension,
// defaulting to jpg for anything unrecognized.
function imageExtension(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  return IMAGE_EXTENSIONS[base] ?? 'jpg'
}

async function finalizeImage(uploadId: string, parts: Uint8Array<ArrayBuffer>[], meta: ImageMeta) {
  const source = getGame()
  const actor = source.actors.get(meta.characterId, { strict: true })

  // Destination is the GM-configured folder; refuse if it's since been cleared.
  const dir = imageUploadPath()
  if (!dir) throw new Error('Image upload destination folder is not configured')

  const picker = getFilePicker()
  await ensureDirectory(picker, 'data', dir)

  // uploadId is a client-minted uuid; strip anything not filename-safe.
  const safeId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '') || 'image'
  const filename = `${safeId}.${imageExtension(meta.mimeType)}`
  const file = new File(parts, filename, { type: meta.mimeType })

  const result = await picker.upload('data', dir, file, {}, { notify: false })
  const imagePath = result && result.path
  if (!imagePath) throw new Error('Image upload returned no path')

  const oocAlias = meta.outOfCharacter ? outOfCharacterAlias(source, meta.userId) : undefined
  const speaker = oocAlias ? { alias: oocAlias } : actorSpeaker(actor)

  // width/height attrs give the intrinsic aspect ratio (reflow-free load); the
  // inline `height:auto` overrides the height presentational hint those
  // attributes imply, so Foundry's own `max-width:100%` scales the image
  // proportionally instead of pinning it to a fixed height (which distorted it).
  // `cursor:pointer` hints the click-to-popout wired in chatImagePopout.ts. The
  // src is escaped (server-generated today, but this keeps an unexpected
  // character in the configured folder from breaking out of the attribute).
  const caption = meta.content ? formatChatContent(meta.content) : ''
  const dims = meta.width && meta.height ? ` width="${meta.width}" height="${meta.height}"` : ''
  const img =
    `<img src="${escapeHtml(imagePath)}"${dims} ` +
    `style="max-width:100%;height:auto;cursor:pointer;" alt="">`
  // Wrapped so the app strips the content copy (see sanitizeChatHtml) and renders
  // its own <img> from the flag, while Foundry's own log shows this one.
  const imageBlock = `<div data-tablemate-image>${img}</div>`
  const content = caption ? `${caption}<br>${imageBlock}` : imageBlock

  const data: Record<string, unknown> = {
    author: meta.userId,
    speaker,
    content,
    flags: {
      tablemate: {
        imagePath,
        imageMimeType: meta.mimeType,
        ...(meta.width ? { imageWidth: meta.width } : {}),
        ...(meta.height ? { imageHeight: meta.height } : {})
      }
    }
  }
  if (meta.whisper?.length) {
    // Mirror the voice/text leak-guard: scope an unresolved private image to its
    // author rather than letting an empty array read as a public message.
    const recipients = resolveWhisperRecipients(meta.whisper)
    data.whisper = recipients.length ? recipients : [meta.userId]
  }

  try {
    await chatMessageClass().create(data)
  } catch (error) {
    // The file uploaded but the message didn't post: surface the failure, and log
    // the orphaned path (Foundry exposes no reliable file-delete here).
    logger.warn('TABLEMATE: image uploaded but chat message failed', imagePath, error)
    throw error
  }
}

const imageAccumulator = makeChunkAccumulator<ImageMeta>({
  label: 'Image',
  maxChunks: MEDIA_UPLOAD_MAX_CHUNKS,
  ttlMs: MEDIA_UPLOAD_TTL_MS,
  finalize: finalizeImage
})

export async function foundrySendImage(args: SendImageArgs) {
  // Feature gate, mirroring the voice-memo handler: refuse outright when the
  // world has no image folder configured.
  if (!imageUploadEnabled()) throw new Error('Image uploads are not enabled for this world')

  await imageAccumulator.accept(
    { uploadId: args.uploadId, seq: args.seq, total: args.total, chunkBase64: args.chunkBase64 },
    {
      userId: args.userId,
      characterId: args.characterId,
      mimeType: args.mimeType,
      width: args.width,
      height: args.height,
      content: args.content,
      outOfCharacter: args.outOfCharacter,
      whisper: args.whisper
    }
  )
  return makeAck(args)
}

export async function foundryRerollChatRoll(args: RerollChatRollArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)

  // The app gates these same conditions client-side (canTriggerRollAction),
  // so reaching one here means the app's state has drifted from the world's —
  // throw so the dispatch answers with an error ack and the app shows the
  // failure instead of pretending the reroll happened.
  const message = source.messages.get(args.messageId) as RerollableChatMessage | undefined
  if (!message) throw new Error(`Chat message ${args.messageId} not found`)

  const messageActorId = message.actor?._id ?? message.speaker?.actor
  if (messageActorId !== actor._id) throw new Error('Roll belongs to a different actor')

  const roll = message.rolls?.[args.rollIndex ?? 0]
  if (roll?.class && roll.class !== 'CheckRoll') {
    throw new Error('Only check rolls can be rerolled')
  }
  if (message.isRerollable === false) throw new Error('This roll can no longer be rerolled')
  // Hero points are a character resource; no other actor type has the pool.
  if (args.mode === 'hero-point') {
    if (!actor.isOfType('character')) {
      throw new Error(`${actor.name} is not a character and has no hero points`)
    }
    if (actor.heroPoints.value <= 0) {
      throw new Error(`${actor.name} has no hero points available`)
    }
  }

  // PF2e's rerollFromMessage creates the replacement message internally without
  // returning it; capture it by request uuid (see chatCapture.ts) rather than
  // grabbing the globally-next message.
  const rerollMessage = await withBackgroundRoll(args.diceResults, async () => {
    const capture = registerCapture(args.uuid)
    await source.pf2e.Check.rerollFromMessage(message as never, rerollOptionsForMode(args.mode))
    return capture
  })

  return { ...makeAck(args), ...extractRollPayload(rerollMessage?.rolls?.[0], args) }
}
