export function withBackgroundRoll<T>(
  diceResults: object | undefined,
  run: () => Promise<T>
): Promise<T>

// Drops every in-flight dice-result override and uninstalls the Roll wrapper.
// Returns the number of frames dropped. See the note in backgroundRoll.js.
export function abandonBackgroundRolls(): number
