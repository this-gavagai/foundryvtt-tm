const appName = 'tablemate'

// The libWrapper on Roll.prototype.evaluate is installed ONCE and reads the
// top-of-stack dice-result context, rather than being registered/unregistered
// per request. libWrapper permits only one registration per target, so two
// overlapping background rolls would otherwise make the second register() throw
// and the first unregister() strip the wrapper mid-flight; and a roll that threw
// left the wrapper installed globally (forcing allowInteractive: false on every
// later roll by anyone). withBackgroundRoll() refcounts the stack and removes
// the wrapper only once the last active roll finishes. Mirrors the refcounted
// prototype-hook pattern in handlers/checks/modifierOverrides.ts.
const diceContextStack = []
let restoreRollEvaluate = null

function currentDiceResults() {
  return diceContextStack[diceContextStack.length - 1]
}

function customRollEvaluate(wrapped, ...args) {
  const diceResults = currentDiceResults()
  // Track how many of each face we've already consumed across this roll's dice
  // terms. A formula like `1d20 + 1d8 + 1d8` should advance the d8 pointer per
  // term (d8[0], then d8[1]) rather than use the global index in `this.dice`
  // (which would look up d8[1] and d8[2]).
  const consumed = {}
  this.dice.forEach((die) => {
    const key = 'd' + die.faces
    const pool = diceResults?.[key]
    if (!pool) return
    // A term like `2d8` is one DiceTerm with `number: 2`, holding two results —
    // pull that many faces from the pool, not just one.
    const needed = die.number ?? 1
    const start = consumed[key] ?? 0
    if (pool.length < start + needed) return
    // Callers use 0 as a "no override, roll live" sentinel (because the upstream
    // API always shapes the payload as { d20: [result ?? 0] }). A real die never
    // produces 0, so any slice containing 0/null/undefined means the user opted
    // out of the override — let Foundry roll the term.
    const slice = Array.from({ length: needed }, (_, j) => pool[start + j])
    consumed[key] = start + needed
    if (slice.some((v) => !v)) return
    die._evaluated = true
    die.results = slice.map((v) => ({ result: v, active: true, hidden: true }))
  })

  // Preserve the caller's original evaluate() options. `args` is the rest-array
  // of the wrapped call, so the options object is args[0]; spreading `args`
  // itself would produce { 0: options, allowInteractive: false } and discard
  // PF2e's maximize/minimize/etc. flags.
  return wrapped({ ...(args[0] ?? {}), allowInteractive: false })
}

function installRollEvaluate() {
  if (restoreRollEvaluate) return
  const registrationId = libWrapper.register(appName, 'Roll.prototype.evaluate', customRollEvaluate)
  restoreRollEvaluate = () => {
    libWrapper.unregister(appName, registrationId)
    restoreRollEvaluate = null
  }
}

// Run `run()` with the given dice-result overrides applied to any Roll evaluated
// during it, then restore. Nesting/concurrency safe via the refcounted stack.
export async function withBackgroundRoll(diceResults, run) {
  installRollEvaluate()
  diceContextStack.push(diceResults ?? {})
  try {
    return await run()
  } finally {
    diceContextStack.pop()
    if (diceContextStack.length === 0) restoreRollEvaluate?.()
  }
}
