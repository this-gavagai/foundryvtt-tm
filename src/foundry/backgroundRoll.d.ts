export function withBackgroundRoll<T>(
  diceResults: object | undefined,
  run: () => Promise<T>
): Promise<T>
