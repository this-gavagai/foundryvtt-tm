import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

export function triggerLightHapticFeedback() {
  if (!Capacitor.isNativePlatform()) return

  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

// A single, soft selection tick — the lightest discrete feedback iOS offers
// (UISelectionFeedbackGenerator), subtler than the Light impact used for taps.
// Used to confirm a menu/modal was dismissed without feeling like a press.
export async function triggerDismissHapticFeedback() {
  if (!Capacitor.isNativePlatform()) return

  try {
    await Haptics.selectionStart()
    await Haptics.selectionChanged()
    await Haptics.selectionEnd()
  } catch {
    // Ignore — haptics are best-effort.
  }
}

// A single firmer thump, matching what iOS plays when a press-and-hold opens a
// context menu. Fired the moment the hold registers — before the menu animates
// in — so the gesture confirms itself rather than leaving the finger guessing.
// Heavier than the Light tap impact on purpose: a long-press is a deliberate,
// held action and should land differently from a tap.
export function triggerLongPressHapticFeedback() {
  if (!Capacitor.isNativePlatform()) return

  void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
}

// A quick pulsating burst that mimics the feel of a die tumbling and settling:
// a few rapid light taps followed by a slightly heavier landing impact.
export function triggerRollHapticFeedback() {
  if (!Capacitor.isNativePlatform()) return

  // Irregular spacing and varying intensity to mimic a die bouncing across a
  // surface before coming to rest with a final, firmer landing.
  const pulses: { delay: number; style: ImpactStyle }[] = [
    { delay: 0, style: ImpactStyle.Light },
    { delay: 45, style: ImpactStyle.Medium },
    { delay: 130, style: ImpactStyle.Light },
    { delay: 190, style: ImpactStyle.Light },
    { delay: 280, style: ImpactStyle.Medium },
    { delay: 410, style: ImpactStyle.Light },
    { delay: 480, style: ImpactStyle.Heavy }
  ]

  pulses.forEach(({ delay, style }) => {
    setTimeout(() => {
      void Haptics.impact({ style }).catch(() => {})
    }, delay)
  })
}
