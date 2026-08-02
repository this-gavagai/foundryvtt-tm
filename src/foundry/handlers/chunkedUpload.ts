import { logger } from '@/utils/utilities'

// Generic reassembly for a file streamed to the GM client as base64 byte-slices
// (see utils/voiceMemoChunks.ts on the sending side). Both voice memos and image
// uploads accumulate identically — buffer the decoded bytes per uploadId until
// the final chunk lands, then run a feature-specific finalize (upload + post).
// The only differences are the sanity cap, the TTL, and what finalize does, so
// each feature makes its own accumulator with those three knobs.

// One chunk on the wire, shared by SendVoiceMemoArgs / SendImageArgs.
export interface UploadChunk {
  uploadId: string
  seq: number
  total: number
  chunkBase64: string
}

interface PendingUpload<M> {
  parts: Array<Uint8Array<ArrayBuffer> | undefined>
  received: number
  total: number
  meta: M
  // Undefined only between constructing the entry and arming its first timer.
  timer: ReturnType<typeof globalThis.setTimeout> | undefined
}

// How an upload ended, once it is no longer buffered: what finalize returned, or
// the error that ended it (a failed finalize, or the gap timer firing before the
// last chunk arrived).
//
// Kept because the app RETRIES a chunk whose ack it never heard, and the honest
// answer to "here is chunk 3 again" depends on what happened the first time. An
// upload that already posted replays its result, so the retry gets the message
// id it was waiting for instead of opening a fresh entry that can never
// complete — which would ack as success while nothing was posted. One that
// failed replays the failure, so the app surfaces it rather than hanging.
type Settled<R> = { result: R } | { error: Error }

// Outcomes remembered, oldest evicted first. Upload ids are per-send uuids, so
// an entry can only ever answer a retry of the same upload — the user's own
// retry of a failed memo mints a new id and starts clean.
const SETTLED_MEMORY = 32

// Return type pinned to Uint8Array<ArrayBuffer> (not the SharedArrayBuffer-
// inclusive default) so the assembled parts satisfy File's BlobPart[].
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function makeChunkAccumulator<M, R = void>(options: {
  // Human-readable noun for error messages ('Voice memo', 'Image').
  label: string
  // Upper bound on chunk count, so a stray/hostile request can't make us
  // allocate a huge buffer array.
  maxChunks: number
  // How long to wait for the NEXT chunk before giving the upload up (app closed
  // mid-send, a GM handoff mid-upload, etc.) so a partial file can't leak memory.
  // A gap budget, not a total one: it re-arms on every chunk, so an upload that
  // keeps arriving is never dropped for taking a while in total. Bounding the
  // total instead would fail exactly the long memos this exists to carry.
  ttlMs: number
  // Runs once, on the final chunk, with the reassembled byte parts in seq order.
  // Whatever it returns is handed back to the caller of the final chunk, which
  // is how the voice-memo path reports the posted message id in its ack.
  finalize: (uploadId: string, parts: Uint8Array<ArrayBuffer>[], meta: M) => Promise<R>
}) {
  const pending = new Map<string, PendingUpload<M>>()
  const settled = new Map<string, Settled<R>>()

  function remember(uploadId: string, outcome: Settled<R>) {
    settled.set(uploadId, outcome)
    // Map iteration is insertion-ordered, so the first key is the oldest.
    while (settled.size > SETTLED_MEMORY) {
      const oldest = settled.keys().next().value
      if (oldest === undefined) break
      settled.delete(oldest)
    }
  }

  // Start (or restart) the gap timer for an upload still in flight.
  function armGapTimer(uploadId: string, entry: PendingUpload<M>) {
    globalThis.clearTimeout(entry.timer)
    entry.timer = globalThis.setTimeout(() => {
      if (!pending.delete(uploadId)) return
      const error = new Error(`${options.label} upload stalled before completion`)
      logger.warn(`TABLEMATE: ${error.message}`, uploadId)
      remember(uploadId, { error })
    }, options.ttlMs)
  }

  // Buffer one chunk. Returns finalize's result when this chunk completed the
  // upload, undefined while more chunks are still expected. Idempotent on a
  // re-sent chunk — only a slot filled for the first time advances the received
  // count, and a chunk of an upload that has already ended replays its outcome.
  // `meta` is kept from the first chunk that opens the entry.
  async function accept(chunk: UploadChunk, meta: M): Promise<R | undefined> {
    if (!Number.isInteger(chunk.total) || chunk.total <= 0 || chunk.total > options.maxChunks) {
      throw new Error(`${options.label} has invalid chunk count ${chunk.total}`)
    }
    if (!Number.isInteger(chunk.seq) || chunk.seq < 0 || chunk.seq >= chunk.total) {
      throw new Error(`${options.label} chunk ${chunk.seq} out of range for total ${chunk.total}`)
    }

    // This upload has already ended, one way or the other — answer with what
    // happened rather than starting it over.
    const outcome = settled.get(chunk.uploadId)
    if (outcome) {
      if ('error' in outcome) throw outcome.error
      return outcome.result
    }

    let entry = pending.get(chunk.uploadId)
    if (!entry) {
      entry = {
        parts: new Array<Uint8Array<ArrayBuffer> | undefined>(chunk.total),
        received: 0,
        total: chunk.total,
        meta,
        timer: undefined
      }
      pending.set(chunk.uploadId, entry)
    }
    // Re-armed per chunk: the budget is the gap between chunks, so a steadily
    // streaming upload keeps its buffer for as long as it needs.
    armGapTimer(chunk.uploadId, entry)

    if (!entry.parts[chunk.seq]) {
      entry.parts[chunk.seq] = base64ToBytes(chunk.chunkBase64)
      entry.received += 1
    }

    if (entry.received < entry.total) return undefined

    // Final chunk: stop the timer, drop the buffer, then finalize. Cleared up
    // front so a finalize failure can't strand the entry. Either way the outcome
    // is remembered, so the ack this chunk owes — result or error — survives the
    // app not hearing it the first time.
    globalThis.clearTimeout(entry.timer)
    pending.delete(chunk.uploadId)
    try {
      const result = await options.finalize(
        chunk.uploadId,
        entry.parts as Uint8Array<ArrayBuffer>[],
        entry.meta
      )
      remember(chunk.uploadId, { result })
      return result
    } catch (error) {
      remember(chunk.uploadId, {
        error: error instanceof Error ? error : new Error(String(error))
      })
      throw error
    }
  }

  return { accept }
}
