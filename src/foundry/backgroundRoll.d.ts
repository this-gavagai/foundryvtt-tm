export function useBackgroundRoll(rollResults?: object): {
  registerBackgroundRoll: () => void
  unregisterBackgroundRoll: () => void
}
