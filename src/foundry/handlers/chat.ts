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
import { getCharacter, getGame, makeAck } from '../utils/foundry'
import { voiceMemoEnabled, voiceMemoUploadPath } from '../voiceMemoSetting'
import { imageUploadEnabled, imageUploadPath } from '../imageUploadSetting'
import { transcriptionConfig, transcribeAudioFile, type TranscriptionConfig } from '../transcriptionSetting'
import { makeChunkAccumulator } from './chunkedUpload'
import { logger } from '@/utils/utilities'

// The created message document, narrowed to the one method we patch it with
// after an async transcription lands.
type CreatedChatMessage = { update: (data: object) => Promise<unknown> }

declare const ChatMessage: {
  create: (data: object) => Promise<CreatedChatMessage | undefined>
  getSpeaker: (opts: { actor?: unknown }) => unknown
}

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

const WHISPER_PREFIX = /^\/w(?:hisper)?\s+/i

// Parse Foundry's `/w` / `/whisper` syntax. Targets may be bracketed
// (`[Display Name]`, so names with spaces work) or a single bare token, and
// several may be comma-separated. The first target not followed by a comma
// ends the recipient list; everything after it is the message body. Returns
// null when the text isn't a whisper command.
function parseWhisperCommand(raw: string): { targets: string[]; content: string } | null {
  if (!WHISPER_PREFIX.test(raw)) return null
  let rest = raw.replace(WHISPER_PREFIX, '')
  const targets: string[] = []
  const tokenPattern = /^(\[[^\]]+\]|[^\s,]+)\s*(,)?\s*/
  while (rest.length) {
    const match = tokenPattern.exec(rest)
    if (!match) break
    targets.push(match[1])
    rest = rest.slice(match[0].length)
    if (!match[2]) break // no trailing comma — the rest is the message body
  }
  return { targets, content: rest }
}

// Resolve whisper target names to Foundry user ids, mirroring Foundry's own
// recipient lookup: the `gm`/`dm` keyword targets all GMs, `players` targets all
// non-GMs, and any other name is matched case-insensitively against user names.
function resolveWhisperRecipients(source: GamePF2e, targets: string[]): string[] {
  const users = Array.from(source.users as Iterable<WhisperUser>)
  const ids = new Set<string>()
  const addAll = (matches: WhisperUser[]) =>
    matches.forEach((u) => {
      if (u.id) ids.add(u.id)
    })

  for (const target of targets) {
    const name = target.replace(/[[\]]/g, '').trim()
    if (!name) continue
    const lower = name.toLowerCase()
    if (lower === 'gm' || lower === 'dm') {
      addAll(users.filter((u) => u.isGM))
    } else if (lower === 'players') {
      addAll(users.filter((u) => !u.isGM))
    } else {
      addAll(users.filter((u) => u.name?.toLowerCase() === lower))
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

// Build a chat speaker for an actor WITHOUT touching the GM client's canvas.
// ChatMessage.getSpeaker resolves scene/token from whatever scene the GM
// happens to have open — which is wrong for a remote player's message (it can
// pick up the GM's selected token) and is undefined when the GM has no scene
// loaded. That canvas dependency is also what trips third-party
// preCreateChatMessage hooks that resolve the token via `canvas.tokens.get(...)`
// (the "Cannot read properties of undefined (reading 'get')" seen on voice-memo
// posts). Attributing by actor id + name is canvas-independent and still shows
// the character — the app falls back to the actor portrait when no token rides
// on the speaker.
function actorSpeaker(actor: { id?: string | null; name?: string | null }): {
  actor?: string
  alias?: string
} {
  return { actor: actor.id ?? undefined, alias: actor.name ?? undefined }
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
    const recipients = resolveWhisperRecipients(source, whisper.targets)
    // An empty `whisper` array reads as a public message in Foundry, which would
    // leak a message the user meant to be private. When nothing resolves, scope
    // it to the author so it stays out of other players' overlays.
    data.whisper = recipients.length ? recipients : [args.userId]
  }

  await ChatMessage.create(data)
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

// Drop an incomplete upload if the remaining chunks never arrive (app closed
// mid-send, GM/proxy handoff, etc.) so a partial file can't leak memory.
const MEDIA_UPLOAD_TTL_MS = 60_000

type VoiceMemoMeta = {
  userId: string
  characterId: string
  mimeType: string
  durationMs: number
  content?: string
  outOfCharacter?: boolean
  whisper?: string[]
}

// Foundry v13 moved FilePicker under foundry.applications.apps; v11/v12 expose
// it as a bare global. Resolve whichever exists so the handler works on both.
type FilePickerLike = {
  upload: (
    source: string,
    path: string,
    file: File,
    body?: object,
    options?: object
  ) => Promise<{ path?: string } | false>
  createDirectory: (source: string, target: string, options?: object) => Promise<unknown>
  browse: (source: string, target: string, options?: object) => Promise<unknown>
}

function getFilePicker(): FilePickerLike {
  const scope = globalThis as {
    foundry?: { applications?: { apps?: { FilePicker?: FilePickerLike } } }
    FilePicker?: FilePickerLike
  }
  const picker = scope.foundry?.applications?.apps?.FilePicker ?? scope.FilePicker
  if (!picker) throw new Error('FilePicker is unavailable in this Foundry client')
  return picker
}

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
) {
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

  // Content builder, optionally with the transcript appended. The transcript
  // rides in a [data-tablemate-transcript] wrapper so Foundry's own chat log
  // renders it (italic, under the player) while the Tablemate app strips that
  // wrapper (see sanitizeChatHtml) and renders the transcript from the flag
  // with its own styling — shown once on each surface, never twice.
  const renderContent = (text?: string): string => {
    const base = caption ? `${caption}<br>${player}` : player
    if (!text) return base
    return `${base}<div data-tablemate-transcript><em>${escapeHtml(text)}</em></div>`
  }

  const data: Record<string, unknown> = {
    author: meta.userId,
    speaker,
    content: renderContent(),
    flags: {
      tablemate: {
        audioPath,
        audioMimeType: meta.mimeType,
        audioDurationMs: meta.durationMs
      }
    }
  }
  if (meta.whisper?.length) {
    // whisper carries the same command targets the text path sends ('gm' /
    // '[Name]'); resolve them with the shared logic. Mirror the text handler's
    // leak-guard: scope an unresolved private memo to its author rather than
    // letting an empty array read as a public message.
    const recipients = resolveWhisperRecipients(source, meta.whisper)
    data.whisper = recipients.length ? recipients : [meta.userId]
  }

  let message: CreatedChatMessage | undefined
  try {
    message = await ChatMessage.create(data)
  } catch (error) {
    // The file uploaded but the message didn't post: surface the failure to the
    // app, and log the orphaned path so it can be reclaimed (Foundry exposes no
    // reliable file-delete here, so we don't attempt a fragile cleanup).
    logger.warn('TABLEMATE: voice memo uploaded but chat message failed', audioPath, error)
    throw error
  }

  // AI transcription runs AFTER the memo posts so it appears instantly; on
  // success we patch the transcript into the already-posted message in place.
  // Fire-and-forget with its own error handling — it must never block the ack,
  // and a failed/slow call just leaves the memo audio-only.
  const tConfig = transcriptionConfig()
  if (tConfig && message) void attachTranscript(message, file, tConfig, renderContent)
}

// Transcribe an uploaded memo, then patch the text into its posted message —
// both the flag (the app renders from it) and the content (Foundry's own chat
// log renders from it). Best-effort: any failure is logged and the memo stays
// audio-only. Runs detached from the RPC ack (see finalizeVoiceMemo).
async function attachTranscript(
  message: CreatedChatMessage,
  file: File,
  config: TranscriptionConfig,
  renderContent: (text?: string) => string
): Promise<void> {
  let transcript: string
  try {
    transcript = await transcribeAudioFile(file, config)
  } catch (error) {
    logger.warn('TABLEMATE: voice memo transcription failed', error)
    return
  }
  try {
    // A document update deep-merges, so setting flags.tablemate.transcript keeps
    // audioPath/mime/duration intact; content is replaced with the transcript-
    // bearing version.
    await message.update({
      content: renderContent(transcript),
      flags: { tablemate: { transcript } }
    })
  } catch (error) {
    logger.warn('TABLEMATE: voice memo transcript update failed', error)
  }
}

const voiceMemoAccumulator = makeChunkAccumulator<VoiceMemoMeta>({
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

  await voiceMemoAccumulator.accept(
    { uploadId: args.uploadId, seq: args.seq, total: args.total, chunkBase64: args.chunkBase64 },
    {
      userId: args.userId,
      characterId: args.characterId,
      mimeType: args.mimeType,
      durationMs: args.durationMs,
      content: args.content,
      outOfCharacter: args.outOfCharacter,
      whisper: args.whisper
    }
  )
  return makeAck(args)
}

// ── Images ───────────────────────────────────────────────────────────────────
// An uploaded image arrives as SEND_IMAGE chunks (SendImageArgs), reassembled by
// the same accumulator as voice memos. On the final chunk we upload the file and
// post a ChatMessage with an <img> in the content (so Foundry's own chat log
// shows it) wrapped in a [data-tablemate-image] div the app strips — the app
// renders its own <img> from flags.tablemate.imagePath. No transcription step.

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

async function finalizeImage(
  uploadId: string,
  parts: Uint8Array<ArrayBuffer>[],
  meta: ImageMeta
) {
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
    const recipients = resolveWhisperRecipients(source, meta.whisper)
    data.whisper = recipients.length ? recipients : [meta.userId]
  }

  try {
    await ChatMessage.create(data)
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
  if (args.mode === 'hero-point' && actor.heroPoints.value <= 0) {
    throw new Error(`${actor.name} has no hero points available`)
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
