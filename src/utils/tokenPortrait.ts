// Portrait art derived from an actor's prototype token, mirroring how Foundry
// draws that token on the canvas.
//
// Two cases, because a dynamic-ring token stores its art twice:
//
//   ring off — `texture.src` is the art and `texture.scaleX/scaleY` scale it
//     against the token's grid square.
//
//   ring on — the canvas draws `ring.subject.texture` (Tokenizer writes a
//     separate "Token.*" file here; `texture.src` stays the full-frame
//     "Avatar.*" portrait) zoomed by `ring.subject.scale` and clipped by the
//     ring's circular mask. `texture.scaleX` is a different knob there — it
//     sizes the whole ringed token against the grid, which means nothing for a
//     fixed-size portrait chip — so only its sign is kept, as that is where
//     Foundry stores the mirror-X/Y flags.
//
// A ring token also reports the ring itself, so callers that can draw it (see
// TokenArt.vue) get the ring's colors and size class. The subject scale doubles
// as the art's zoom relative to the ring circle: Foundry draws the ring at the
// token's grid footprint and the art at `subject.scale` times that, so a chip
// that renders the ring at its own size renders the art at that multiple.
//
// Callers that DON'T draw the ring must clip the art to the portrait circle.
// Subject scales above 1 are the norm — ring art is authored with transparent
// padding so the ring shows around it — so on its own the art is meant to
// overflow, and only the padding keeps it looking contained.

type TokenTexture = {
  src?: string | null
  scaleX?: number | null
  scaleY?: number | null
}

type TokenRing = {
  enabled?: boolean | null
  // Deliberately loose: over the wire these are source-data hex strings, but
  // the upstream prepared types declare Foundry `Color` instances. hexColor
  // normalizes both.
  colors?: {
    ring?: unknown
    background?: unknown
  } | null
  subject?: {
    texture?: string | null
    scale?: number | null
  } | null
}

// What TokenArt.vue needs to build the ring layers for this token.
export type PortraitRing = {
  ringColor: string | null
  backgroundColor: string | null
  // Grid footprint, which picks the spritesheet's size class.
  gridSize: number
}

type PortraitToken = {
  texture?: TokenTexture | null
  ring?: TokenRing | null
  width?: number | null
  height?: number | null
} | null

export type TokenPortrait = {
  url: string | undefined
  scaleX: number
  scaleY: number
  // Absent unless the token draws a dynamic ring.
  ring?: PortraitRing
}

// Foundry stores mirroring as a negative scale, so a scale we otherwise ignore
// still decides which way the art faces.
function sign(scale: number | null | undefined): number {
  return scale != null && scale < 0 ? -1 : 1
}

// Ring colors reach this app as '#rrggbb' source data, but Foundry's prepared
// documents hold `Color` objects (a Number subclass) and the upstream types
// describe that shape. Accept either and hand on a plain hex string.
function hexColor(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return `#${(numeric & 0xffffff).toString(16).padStart(6, '0')}`
}

export function tokenPortrait(
  prototypeToken: PortraitToken | undefined,
  fallbackUrl?: string
): TokenPortrait {
  const texture = prototypeToken?.texture
  const ring = prototypeToken?.ring

  if (ring?.enabled) {
    const scale = ring.subject?.scale ?? 1
    return {
      url: ring.subject?.texture || texture?.src || fallbackUrl || undefined,
      scaleX: Math.abs(scale) * sign(texture?.scaleX),
      scaleY: Math.abs(scale) * sign(texture?.scaleY),
      ring: {
        ringColor: hexColor(ring.colors?.ring),
        backgroundColor: hexColor(ring.colors?.background),
        // Foundry matches the ring to the smaller of the two dimensions.
        gridSize: Math.min(prototypeToken?.width ?? 1, prototypeToken?.height ?? 1)
      }
    }
  }

  return {
    url: texture?.src || fallbackUrl || undefined,
    scaleX: texture?.scaleX ?? 1,
    scaleY: texture?.scaleY ?? 1
  }
}
