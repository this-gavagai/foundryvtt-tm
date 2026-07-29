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
  timer: ReturnType<typeof globalThis.setTimeout>
}

// Return type pinned to Uint8Array<ArrayBuffer> (not the SharedArrayBuffer-
// inclusive default) so the assembled parts satisfy File's BlobPart[].
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function makeChunkAccumulator<M>(options: {
  // Human-readable noun for error messages ('Voice memo', 'Image').
  label: string
  // Upper bound on chunk count, so a stray/hostile request can't make us
  // allocate a huge buffer array.
  maxChunks: number
  // Drop an incomplete upload if the remaining chunks never arrive (app closed
  // mid-send, GM/proxy handoff, etc.) so a partial file can't leak memory.
  ttlMs: number
  // Runs once, on the final chunk, with the reassembled byte parts in seq order.
  finalize: (uploadId: string, parts: Uint8Array<ArrayBuffer>[], meta: M) => Promise<void>
}) {
  const pending = new Map<string, PendingUpload<M>>()

  // Buffer one chunk. Returns true when this chunk completed the upload (finalize
  // has run), false while more chunks are still expected. Idempotent on a re-sent
  // chunk — only a slot filled for the first time advances the received count.
  // `meta` is kept from the first chunk that opens the entry.
  async function accept(chunk: UploadChunk, meta: M): Promise<boolean> {
    if (!Number.isInteger(chunk.total) || chunk.total <= 0 || chunk.total > options.maxChunks) {
      throw new Error(`${options.label} has invalid chunk count ${chunk.total}`)
    }
    if (!Number.isInteger(chunk.seq) || chunk.seq < 0 || chunk.seq >= chunk.total) {
      throw new Error(`${options.label} chunk ${chunk.seq} out of range for total ${chunk.total}`)
    }

    let entry = pending.get(chunk.uploadId)
    if (!entry) {
      entry = {
        parts: new Array<Uint8Array<ArrayBuffer> | undefined>(chunk.total),
        received: 0,
        total: chunk.total,
        meta,
        timer: globalThis.setTimeout(() => {
          if (pending.delete(chunk.uploadId)) {
            logger.warn(
              `TABLEMATE: ${options.label} upload timed out before completion`,
              chunk.uploadId
            )
          }
        }, options.ttlMs)
      }
      pending.set(chunk.uploadId, entry)
    }

    if (!entry.parts[chunk.seq]) {
      entry.parts[chunk.seq] = base64ToBytes(chunk.chunkBase64)
      entry.received += 1
    }

    if (entry.received < entry.total) return false

    // Final chunk: stop the TTL, drop the buffer, then finalize. Cleared up front
    // so a finalize failure can't strand the entry.
    globalThis.clearTimeout(entry.timer)
    pending.delete(chunk.uploadId)
    await options.finalize(chunk.uploadId, entry.parts as Uint8Array<ArrayBuffer>[], entry.meta)
    return true
  }

  return { accept }
}
