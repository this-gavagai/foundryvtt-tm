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
      die._evaluated = true
      die.results = Array.from({ length: needed }, (_, j) => ({
        result: pool[start + j],
        active: true,
        hidden: true
      }))
      consumed[key] = start + needed
    })

    return wrapped({ ...args, allowInteractive: false })
  }

  function registerBackgroundRoll() {
    libWrapper.unregister_all(appName)
    registrationId = libWrapper.register(appName, 'Roll.prototype.evaluate', customRollEvaluate)
  }
  function unregisterBackgroundRoll() {
    libWrapper.unregister(appName, registrationId)
  }

  return { registerBackgroundRoll, unregisterBackgroundRoll }
}
