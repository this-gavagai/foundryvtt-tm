// Dynamic token ring art, rebuilt outside the canvas.
//
// Foundry draws a ringed token entirely on the GPU: one mesh, a spritesheet of
// ring/background frames, and a batch shader that tints them per token. None of
// that is reachable from this app, so the ring is reassembled here as two plain
// images the DOM can stack under and over the subject art (see TokenArt.vue).
//
// The tinting mirrors `TokenRingSamplerShader`:
//
//   ring        inside the frame's colorBand annulus the texture is replaced by
//               ringColor weighted by the texture's red channel; outside it the
//               texture passes through untouched (that's the metal bezel).
//   background  overlay-blended with backgroundColor, skipped when the tint is
//               white.
//
// Distances are measured in frame-normalized units (0 at the centre, 1 at the
// frame edge) — the shader's `dist` works out to exactly that once the ring's
// UV scale correction is unwound, so it is independent of subject scale and of
// the world's ring fit mode.
//
// Not reproduced: the time-driven effects (RING_PULSE, RING_GRADIENT,
// BKG_WAVE, INVISIBILITY), COLOR_OVER_SUBJECT, and any runtime recolor a system
// or module applies through `Token#getRingColors` (pf2e-reactive-token-ring
// tints by HP that way). Those need the live canvas; the document's own colors
// are what this app has.

import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { getMediaPath, logger } from '@/utils/utilities'

// Foundry's fallback when a spritesheet declares no colorBand of its own
// (TokenRing.createAssetsUVs).
const DEFAULT_COLOR_BAND = { startRadius: 0.59, endRadius: 0.7225 }

export type ColorBand = { startRadius: number; endRadius: number }

export type SheetFrame = { x: number; y: number; w: number; h: number }

// One size class of a ring spritesheet: the ring frame, its matching background
// frame, and the colors/geometry that go with them.
export type RingSizeClass = {
  ringName: string
  bkgName: string
  gridTarget: number
  colorBand: ColorBand
  defaultRingColor: string | null
  defaultBackgroundColor: string | null
}

export type RingSheet = {
  frames: Record<string, SheetFrame>
  sizes: RingSizeClass[]
}

type SheetJson = {
  config?: {
    defaultColorBand?: ColorBand
    defaultRingColor?: string
    defaultBackgroundColor?: string
  }
  frames?: Record<
    string,
    {
      frame?: SheetFrame
      colorBand?: ColorBand
      gridTarget?: number
      ringColor?: string
      backgroundColor?: string
    }
  >
  meta?: { image?: string }
}

/* -------------------------------------------- */
/*  Pure helpers                                */
/* -------------------------------------------- */

// Classify a spritesheet's frames into size classes, mirroring
// TokenRing.createAssetsUVs: every frame that isn't itself a background or mask
// is a ring, and its companions are that name plus `-bkg`/`-msk`.
export function parseRingSheet(json: SheetJson): RingSheet {
  const frames: Record<string, SheetFrame> = {}
  for (const [name, data] of Object.entries(json.frames ?? {})) {
    if (data?.frame) frames[name] = data.frame
  }

  const sheetBand = json.config?.defaultColorBand ?? DEFAULT_COLOR_BAND
  const sizes: RingSizeClass[] = []
  for (const [name, data] of Object.entries(json.frames ?? {})) {
    if (name.includes('-bkg') || name.includes('-msk')) continue
    if (!data?.frame) continue
    sizes.push({
      ringName: name,
      bkgName: `${name}-bkg`,
      gridTarget: data.gridTarget ?? 1,
      colorBand: data.colorBand ?? sheetBand,
      defaultRingColor: data.ringColor ?? json.config?.defaultRingColor ?? null,
      defaultBackgroundColor: data.backgroundColor ?? json.config?.defaultBackgroundColor ?? null
    })
  }
  sizes.sort((a, b) => a.gridTarget - b.gridTarget)
  return { frames, sizes }
}

// Nearest size class by grid footprint, as TokenRing.getRingDataBySize does.
export function pickRingSize(sheet: RingSheet, gridSize: number): RingSizeClass | undefined {
  if (!sheet.sizes.length) return undefined
  if (!Number.isFinite(gridSize)) return sheet.sizes[0]
  return sheet.sizes.reduce((best, size) =>
    Math.abs(size.gridTarget - gridSize) < Math.abs(best.gridTarget - gridSize) ? size : best
  )
}

export type Rgb = [number, number, number]

export function parseColor(color: string | number | null | undefined): Rgb | undefined {
  if (color == null) return undefined
  if (typeof color === 'number') {
    return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
  }
  const hex = color.trim().replace(/^#/, '')
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return undefined
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

// TokenRing#configureVisuals: the document's color wins, except that white (or
// an absent color, which Foundry reads as white) defers to the spritesheet's
// own default when it has one.
export function resolveRingColor(
  tokenColor: string | null | undefined,
  sheetDefault: string | null | undefined
): Rgb | undefined {
  const chosen = parseColor(tokenColor) ?? [0xff, 0xff, 0xff]
  const isWhite = chosen[0] === 0xff && chosen[1] === 0xff && chosen[2] === 0xff
  if (isWhite) {
    const fallback = parseColor(sheetDefault)
    if (fallback) return fallback
  }
  return chosen
}

// Replace the ring texture's color inside the colorBand annulus with
// `color × redChannel`, leaving alpha and everything outside the band alone.
// Operates on straight-alpha canvas pixels, so the shader's unpremultiply step
// is just a /255.
export function tintRingPixels(
  pixels: Uint8ClampedArray,
  size: number,
  color: Rgb,
  band: ColorBand
): void {
  const [tr, tg, tb] = color
  for (let i = 0, px = 0; i < pixels.length; i += 4, px++) {
    if (!pixels[i + 3]) continue
    // Frame-normalized offset from the centre, matching the shader's `dist`.
    const dx = ((px % size) / size - 0.5) * 2
    const dy = (((px / size) | 0) / size - 0.5) * 2
    const dist = Math.hypot(dx, dy)
    if (dist < band.startRadius || dist >= band.endRadius) continue
    const red = pixels[i] / 255
    pixels[i] = tr * red
    pixels[i + 1] = tg * red
    pixels[i + 2] = tb * red
  }
}

// Overlay-blend the background texture with the tint, as colorizeTokenBackground
// does. A white tint means "no tint" there, so it never reaches this function.
export function tintBackgroundPixels(pixels: Uint8ClampedArray, color: Rgb): void {
  const tint = color.map((c) => c / 255)
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue
    for (let c = 0; c < 3; c++) {
      const base = pixels[i + c] / 255
      const blended = base < 0.5 ? 2 * base * tint[c] : 1 - 2 * (1 - base) * (1 - tint[c])
      pixels[i + c] = blended * 255
    }
  }
}

/* -------------------------------------------- */
/*  Asset loading                               */
/* -------------------------------------------- */

// Ring spritesheets live on the Foundry server, which sends no CORS headers.
// Reading their pixels back out of a canvas therefore needs same-origin bytes:
// on web the app IS same-origin, but the native build runs from capacitor://,
// where only CapacitorHttp (native networking, shared cookie jar) can fetch
// them. Its base64 payload becomes a data: URL, which is same-origin by
// definition and so leaves the canvas untainted.
async function fetchAsset(path: string): Promise<Blob> {
  const url = getMediaPath(path)
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url, responseType: 'blob' })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Ring asset fetch returned ${response.status}`)
    }
    const base64 = typeof response.data === 'string' ? response.data : ''
    if (!base64) throw new Error('Empty ring asset response')
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes])
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Ring asset fetch returned ${response.status}`)
  return response.blob()
}

type LoadedSheet = { sheet: RingSheet; image: ImageBitmap }

// One in-flight/settled promise per spritesheet path. The sheets are large
// (the core steel sheet is 4096² / 1.5 MB) and every ringed token on screen
// wants the same one, so they are decoded once per session and the composited
// output is cached separately below.
const sheetCache = new Map<string, Promise<LoadedSheet>>()

async function loadRingSheet(spritesheet: string): Promise<LoadedSheet> {
  const cached = sheetCache.get(spritesheet)
  if (cached) return cached

  const load = (async () => {
    const json = JSON.parse(await (await fetchAsset(spritesheet)).text()) as SheetJson
    const sheet = parseRingSheet(json)
    const imageName = json.meta?.image
    if (!imageName) throw new Error('Ring spritesheet declares no image')
    // The sheet's `meta.image` is a bare filename beside the JSON.
    const imagePath = spritesheet.replace(/[^/]+$/, imageName)
    const bitmap = await createImageBitmap(await fetchAsset(imagePath))
    return { sheet, image: bitmap }
  })()

  sheetCache.set(spritesheet, load)
  // A failed load must not poison the cache — a later render may succeed once
  // the session is authenticated or the network comes back.
  load.catch(() => sheetCache.delete(spritesheet))
  return load
}

export type RingLayers = { ring: string; background: string }

export type RingLayerRequest = {
  spritesheet: string
  gridSize: number
  ringColor?: string | null
  backgroundColor?: string | null
  // Rendered edge length in device pixels. Layers are shared across every
  // avatar of the same size bucket, so this is quantized by the caller.
  px: number
}

const layerCache = new Map<string, Promise<RingLayers>>()
// Settled results, so a caller that remounts (chat rebuilds its rows freely)
// can read an already-composited ring synchronously instead of waiting a
// microtask on the resolved promise — which would blink the ring off and back
// on with every re-render.
const settledLayers = new Map<string, RingLayers>()

function layerKey(request: RingLayerRequest): string {
  const { spritesheet, gridSize, ringColor, backgroundColor, px } = request
  return [spritesheet, gridSize, ringColor ?? '', backgroundColor ?? '', px].join('|')
}

function drawFrame(image: ImageBitmap, frame: SheetFrame, px: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(px, px)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D context for ring compositing')
  ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, px, px)
  return canvas
}

async function toObjectUrl(canvas: OffscreenCanvas): Promise<string> {
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
}

// Layers for this request if they have already been built, else undefined.
export function settledRingLayers(request: RingLayerRequest | undefined): RingLayers | undefined {
  return request ? settledLayers.get(layerKey(request)) : undefined
}

// Build (or reuse) the two tinted layers for one ring/size/color combination.
// Rejects rather than resolving to blanks so callers can fall back to plain art.
export function ringLayers(request: RingLayerRequest): Promise<RingLayers> {
  const key = layerKey(request)
  const cached = layerCache.get(key)
  if (cached) return cached

  const build = (async () => {
    const { sheet, image } = await loadRingSheet(request.spritesheet)
    const size = pickRingSize(sheet, request.gridSize)
    if (!size) throw new Error('Ring spritesheet declares no ring frames')
    const ringFrame = sheet.frames[size.ringName]
    const bkgFrame = sheet.frames[size.bkgName]
    if (!ringFrame) throw new Error(`Ring frame ${size.ringName} missing from spritesheet`)

    const px = request.px
    const ringCanvas = drawFrame(image, ringFrame, px)
    const ringCtx = ringCanvas.getContext('2d')!
    const ringColor = resolveRingColor(request.ringColor, size.defaultRingColor)
    if (ringColor) {
      const data = ringCtx.getImageData(0, 0, px, px)
      tintRingPixels(data.data, px, ringColor, size.colorBand)
      ringCtx.putImageData(data, 0, 0)
    }

    // A sheet may ship a ring with no background frame; an empty layer keeps
    // the markup uniform rather than making every caller branch.
    let background = ''
    if (bkgFrame) {
      const bkgCanvas = drawFrame(image, bkgFrame, px)
      const bkgCtx = bkgCanvas.getContext('2d')!
      const bkgColor = resolveRingColor(request.backgroundColor, size.defaultBackgroundColor)
      // White is Foundry's "leave it alone" value for the background tint.
      if (bkgColor && !(bkgColor[0] === 0xff && bkgColor[1] === 0xff && bkgColor[2] === 0xff)) {
        const data = bkgCtx.getImageData(0, 0, px, px)
        tintBackgroundPixels(data.data, bkgColor)
        bkgCtx.putImageData(data, 0, 0)
      }
      background = await toObjectUrl(bkgCanvas)
    }

    return { ring: await toObjectUrl(ringCanvas), background }
  })()

  layerCache.set(key, build)
  build.then((resolved) => settledLayers.set(key, resolved)).catch(() => {})
  build.catch((error) => {
    layerCache.delete(key)
    logger.debug('token ring layers unavailable', error)
  })
  return build
}

// Test seam: the caches are module-level singletons keyed by immutable inputs,
// so nothing invalidates them in a session — but a spec that stubs fetch needs
// a clean slate between cases.
export function __resetRingCaches(): void {
  sheetCache.clear()
  layerCache.clear()
  settledLayers.clear()
}
