const appName = 'tablemate'

export function useBackgroundRoll(diceResults = {}) {
  let registrationId
  const customRollEvaluate = async function (wrapped, ...args) {
    console.log(...args)
    console.log(this)
    const background = true //this.options.identifier === identifier_code
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
    console.log(registrationId)
  }
  function unregisterBackgroundRoll() {
    console.log(registrationId)
    libWrapper.unregister(appName, registrationId)
  }

  return { registerBackgroundRoll, unregisterBackgroundRoll }
}
