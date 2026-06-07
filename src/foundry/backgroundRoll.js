const appName = 'tablemate'

export function useBackgroundRoll(diceResults = {}) {
  let registrationId
  const customRollEvaluate = async function (wrapped, ...args) {
    // Track how many of each face we've already consumed across this roll's
    // dice terms. A formula like `1d20 + 1d8 + 1d8` should advance the d8
    // pointer per term (d8[0], then d8[1]) rather than use the global index
    // in `this.dice` (which would look up d8[1] and d8[2]).
    const consumed = {}
    this.dice.forEach((die) => {
      const key = 'd' + die.faces
      const pool = diceResults?.[key]
      if (!pool) return
      // A term like `2d8` is one DiceTerm with `number: 2`, holding two
      // results — pull that many faces from the pool, not just one.
      const needed = die.number ?? 1
      const start = consumed[key] ?? 0
      if (pool.length < start + needed) return
      // Callers use 0 as a "no override, roll live" sentinel (because the
      // upstream API always shapes the payload as { d20: [result ?? 0] }).
      // A real die never produces 0, so any slice containing 0/null/undefined
      // means the user opted out of the override — let Foundry roll the term.
      const slice = Array.from({ length: needed }, (_, j) => pool[start + j])
      consumed[key] = start + needed
      if (slice.some((v) => !v)) return
      die._evaluated = true
      die.results = slice.map((v) => ({ result: v, active: true, hidden: true }))
    })

    return wrapped({ ...args, allowInteractive: false })
  }

  function registerBackgroundRoll() {
    if (registrationId) libWrapper.unregister(appName, registrationId)
    registrationId = libWrapper.register(appName, 'Roll.prototype.evaluate', customRollEvaluate)
  }
  function unregisterBackgroundRoll() {
    libWrapper.unregister(appName, registrationId)
  }

  return { registerBackgroundRoll, unregisterBackgroundRoll }
}
