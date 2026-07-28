// Slice recorded audio into base64 chunks small enough to cross Foundry's
// per-message socket buffer. Each chunk encodes a RAW BYTE RANGE independently
// (not a substring of one big base64 string), so the Foundry side can decode
// each and concatenate the bytes without hitting base64 padding seams. See
// foundry/handlers/chat.ts (foundrySendVoiceMemo) for the reassembly side.

// 192 KiB of raw bytes ≈ 256 KiB base64, comfortably under the ~1 MB socket
// payload cap once the RPC envelope is added. A 5-minute low-bitrate clip is a
// handful of these.
export const VOICE_MEMO_CHUNK_SIZE = 192 * 1024

// btoa needs a binary string; build it in blocks so a large slice doesn't blow
// the argument limit of String.fromCharCode(...spread).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const block = 0x8000
  for (let offset = 0; offset < bytes.length; offset += block) {
    const slice = bytes.subarray(offset, offset + block)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

// Split raw bytes into base64 chunks of at most `chunkSize` raw bytes each.
// Returns [] for empty input (callers guard against sending an empty memo).
export function sliceBytesToBase64Chunks(
  bytes: Uint8Array,
  chunkSize: number = VOICE_MEMO_CHUNK_SIZE
): string[] {
  if (chunkSize <= 0) throw new Error(`Invalid voice-memo chunk size ${chunkSize}`)
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytesToBase64(bytes.subarray(offset, offset + chunkSize)))
  }
  return chunks
}
