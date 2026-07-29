// Prepare a picked image for the chunked upload (see utils/voiceMemoChunks.ts +
// api sendImage). A phone photo can be several MB, which is heavy to stream as
// base64 socket chunks, so we downscale anything larger than MAX_EDGE and
// re-encode it before slicing — the image analogue of the voice recorder's
// duration cap. Small images (and animated GIFs, which a canvas would flatten)
// pass through untouched.

// Container types we accept from the picker. Anything else is refused up front
// so we never stream a file the GM's FilePicker would reject.
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

// Reject absurd source files before decoding — a real photo is a handful of MB.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

// Longest edge kept after downscaling. Bounds the uploaded payload while staying
// crisp on a tablet screen.
const MAX_EDGE = 1920

// Re-encode quality for the downscaled output (JPEG/WebP).
const ENCODE_QUALITY = 0.85

export interface PreparedImage {
  // Pinned to Uint8Array<ArrayBuffer> (not the SharedArrayBuffer-inclusive
  // default) so the bytes satisfy Blob/File's BlobPart[] when previewed/sent.
  bytes: Uint8Array<ArrayBuffer>
  mimeType: string
  width: number
  height: number
}

// Distinguish why preparation failed so the composer can show the right message.
export type ImagePrepareErrorKind = 'invalid' | 'too-large' | 'failed'
export class ImagePrepareError extends Error {
  constructor(readonly kind: ImagePrepareErrorKind) {
    super(kind)
    this.name = 'ImagePrepareError'
  }
}

// Preparation needs canvas + object URLs, present in the PWA and both mobile
// WebViews. Mirrors audioRecordingSupported()'s role for the mic.
export function imageUploadSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  )
}

interface DecodedImage {
  draw: CanvasImageSource
  width: number
  height: number
  release: () => void
}

// Decode via createImageBitmap when available (fast, off the main DOM), else
// fall back to an <img> + object URL for older WebViews.
async function decodeImage(file: File): Promise<DecodedImage> {
  const createBitmap = (globalThis as { createImageBitmap?: typeof createImageBitmap })
    .createImageBitmap
  if (createBitmap) {
    const bitmap = await createBitmap(file)
    return {
      draw: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close()
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new ImagePrepareError('failed'))
      el.src = url
    })
    return {
      draw: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url)
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImagePrepareError('failed'))),
      type,
      quality
    )
  })
}

// Validate + (if needed) downscale a picked image. Throws ImagePrepareError with
// a kind the caller can map to a message. Animated GIFs and already-small images
// are passed through as their original bytes.
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const type = file.type?.split(';')[0].trim().toLowerCase()
  if (!type || !ACCEPTED_TYPES.has(type)) throw new ImagePrepareError('invalid')
  if (file.size > MAX_SOURCE_BYTES) throw new ImagePrepareError('too-large')

  const decoded = await decodeImage(file)
  try {
    const { width, height } = decoded
    const scale = width && height ? Math.min(1, MAX_EDGE / Math.max(width, height)) : 1

    // Keep the original bytes when no downscale is needed, or for GIFs (drawing
    // to a canvas would collapse an animation to its first frame).
    if (scale >= 1 || type === 'image/gif') {
      const bytes = new Uint8Array(await file.arrayBuffer())
      return { bytes, mimeType: type, width, height }
    }

    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImagePrepareError('failed')
    ctx.drawImage(decoded.draw, 0, 0, targetW, targetH)

    // PNG keeps its (possible) transparency; everything else re-encodes to JPEG.
    const outType = type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await canvasToBlob(canvas, outType, ENCODE_QUALITY)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return { bytes, mimeType: outType, width: targetW, height: targetH }
  } finally {
    decoded.release()
  }
}
