// A stand-in portrait for a human, drawn from the two things Foundry always
// knows about a user: their name and their color.
//
// Needed because out-of-character posts have no character art to show. Foundry's
// own log answers that by outlining an OOC message in `user.color` (see
// ChatMessage#renderHTML, which sets borderColor for CHAT_MESSAGE_STYLES.OOC),
// and the color exists precisely to be recognizable at a glance — it's a
// required field with a random initial value, so every user has one whether or
// not anyone ever chose it.
//
// The initials carry the identity and the color carries the recognition; neither
// is load-bearing alone, which is why the badge always renders both.

export interface UserBadge {
  // The user's color as CSS, or the neutral below when the world has nothing
  // usable. The badge still identifies by initials in that case.
  background: string
  // Black or white, whichever stays legible on `background`. User colors are
  // arbitrary — Foundry seeds them randomly and the color picker allows
  // anything — so this cannot be a fixed choice.
  foreground: string
  initials: string
}

// Where a user has no color at all (an older world, a hand-edited document): a
// mid-gray that reads as deliberate on both light and dark themes rather than
// as a broken value.
const NEUTRAL = '#6b7280'

// Foundry stores a user's color as a CSS hex string in source data, but a
// prepared document holds a `Color` (a Number subclass), and this app sees both
// shapes depending on where the user came from (see the same accommodation in
// utils/tokenPortrait). Shorthand `#rgb` is accepted because the color picker's
// output is hand-editable.
function normalizeHex(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`
  }
  if (typeof value !== 'string') return undefined
  const hex = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return undefined
}

// WCAG relative luminance, which is what decides black-vs-white text. The naive
// alternative (average the channels, or compare against #808080) picks white on
// mid-yellows and mid-cyans, where black is far more legible — and those are
// common Foundry user colors, not corner cases.
function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

// Up to two initials, from the first and last word of the displayed name — so
// "Peter" reads "P" and "The Human" reads "TH". Split on any whitespace and
// taken with Array.from, so a name whose first character is an emoji or an
// astral-plane glyph yields that whole character rather than half a surrogate
// pair.
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  const first = Array.from(words[0])[0] ?? ''
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : ''
  return `${first}${last}`.toLocaleUpperCase()
}

export function userBadge(name: string | null | undefined, color: unknown): UserBadge {
  const background = normalizeHex(color) ?? NEUTRAL
  return {
    background,
    // 0.179 is where the two choices are exactly equal: contrast against white
    // is 1.05/(L+0.05) and against black (L+0.05)/0.05, which meet at
    // L = 0.0525^0.5 - 0.05. Above it black wins, below it white does.
    foreground: relativeLuminance(background) > 0.179 ? '#000000' : '#ffffff',
    initials: initialsFor(name ?? '')
  }
}
