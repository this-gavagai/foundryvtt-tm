import { describe, it, expect } from 'vitest'
import { sliceBytesToBase64Chunks } from '@/utils/voiceMemoChunks'

// Decode the way the Foundry side does: each chunk independently, then
// concatenate bytes. This is the round-trip the socket transport relies on.
function reassemble(chunks: string[]): Uint8Array {
  const parts = chunks.map((c) => {
    const binary = atob(c)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  })
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

describe('sliceBytesToBase64Chunks', () => {
  it('round-trips bytes whose length is not a multiple of 3 (base64 padding)', () => {
    // 10 bytes with chunk size 4 → lengths [4,4,2]; per-chunk padding must not
    // corrupt the concatenation.
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const chunks = sliceBytesToBase64Chunks(bytes, 4)
    expect(chunks).toHaveLength(3)
    expect(Array.from(reassemble(chunks))).toEqual(Array.from(bytes))
  })

  it('produces a single chunk when the data fits', () => {
    const bytes = new Uint8Array([200, 100, 50])
    const chunks = sliceBytesToBase64Chunks(bytes, 1024)
    expect(chunks).toHaveLength(1)
    expect(Array.from(reassemble(chunks))).toEqual([200, 100, 50])
  })

  it('handles the full byte range without corruption', () => {
    const bytes = new Uint8Array(1000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    const chunks = sliceBytesToBase64Chunks(bytes, 97) // deliberately awkward size
    expect(Array.from(reassemble(chunks))).toEqual(Array.from(bytes))
  })

  it('returns no chunks for empty input', () => {
    expect(sliceBytesToBase64Chunks(new Uint8Array(0), 128)).toEqual([])
  })

  it('rejects a non-positive chunk size', () => {
    expect(() => sliceBytesToBase64Chunks(new Uint8Array([1]), 0)).toThrow(/chunk size/)
  })
})
