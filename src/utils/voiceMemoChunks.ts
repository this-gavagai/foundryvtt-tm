// Slice recorded audio into base64 chunks small enough to cross Foundry's
// per-message socket buffer. Each chunk encodes a RAW BYTE RANGE independently
// (not a substring of one big base64 string), so the Foundry side can decode
// each and concatenate the bytes without hitting base64 padding seams. See
// foundry/handlers/chat.ts (foundrySendVoiceMemo) for the reassembly side.

// 640 KiB of raw bytes ≈ 853 KiB base64, which still fits socket.io's DEFAULT
// 1 MB (1e6) maxHttpBufferSize once the RPC envelope is added. Foundry itself
// raises that to 1e8 — a single 8 MB frame crosses it, and a dev-server or
// reverse proxy in front of it, without complaint — but sizing to the library
// default keeps the chunk safe against a Foundry version that doesn't override
// it.
//
// Chosen to keep the ROUND TRIPS down, not to be as small as possible. A memo
// records at roughly 180 kbps, so a minute of audio is ~1.4 MB: at the 192 KiB
// this used to be, that was 7 chunks (a five-minute memo, 35), and since each
// chunk must be acked before the next goes out, every extra round trip is
// another chance for the ack the whole upload hangs on to go missing. The same
// minute is 3 chunks at this size, and five minutes is 11.
export const VOICE_MEMO_CHUNK_SIZE = 640 * 1024

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
