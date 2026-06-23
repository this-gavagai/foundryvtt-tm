import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

export function triggerLightHapticFeedback() {
  if (!Capacitor.isNativePlatform()) return

  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}
