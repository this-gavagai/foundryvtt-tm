const appName = 'tablemate'

export function useBackgroundRoll(diceResults = {}) {
  let registrationId
  const customRollEvaluate = async function (wrapped, ...args) {
    const background = true
    if (background) {
      this.dice.forEach((die, i) => {
        if (diceResults?.['d' + die.faces]?.[i]) {
          die._evaluated = true
          die.results = [
            { result: diceResults?.['d' + die.faces]?.[i] ?? undefined, active: true, hidden: true }
          ]
        }
      })
    }

    return wrapped({ ...args, allowInteractive: !background })
  }

  function registerBackgroundRoll() {
    registrationId = libWrapper.register(appName, 'Roll.prototype.evaluate', customRollEvaluate)
  }
  function unregisterBackgroundRoll() {
    libWrapper.unregister(appName, registrationId)
  }

  return { registerBackgroundRoll, unregisterBackgroundRoll }
}
