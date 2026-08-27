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
//
// Entries are objects rather than bare diceResults so a frame can be identified
// on the way out — see the removal note in withBackgroundRoll.
const diceContextStack = []
let restoreRollEvaluate = null

function currentDiceResults() {
  return diceContextStack[diceContextStack.length - 1]?.diceResults
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
  const frame = { diceResults: diceResults ?? {} }
  diceContextStack.push(frame)
  try {
    return await run()
  } finally {
    // Remove OUR frame by identity, not the top one by position. Frames normally
    // settle in LIFO order, but not always: when the dispatch queue gives up on a
    // hung handler (HANDLER_QUEUE_TIMEOUT_MS in listener.ts) the next request
    // starts while the hung one is still running, so a positional pop here would
    // discard the frame of whichever request is executing NOW and leave the hung
    // one's faces on top of the stack. Mirrors the splice-by-identity the chat
    // origin stack already does for the same reason.
    const index = diceContextStack.lastIndexOf(frame)
    if (index >= 0) diceContextStack.splice(index, 1)
    if (diceContextStack.length === 0) restoreRollEvaluate?.()
  }
}

// Drop every dice-result override in flight and uninstall the wrapper.
//
// Called when the dispatch queue abandons a hung handler. Without it, that
// handler's frame stays on the stack for the rest of the session: once the queue
// drains it is top-of-stack again, so `currentDiceResults()` answers with a
// player's chosen faces for EVERY later roll on this client — including rolls the
// GM makes in Foundry's own UI. The stack never reaching empty also pins the
// libWrapper in place, forcing allowInteractive: false on all of them.
//
// Safe to call while the abandoned handler is still running: its own `finally`
// removes its frame by identity, so a frame already dropped here is simply not
// found. Its later rolls lose their overrides, which is the point — nothing is
// waiting on them any more.
//
// Returns how many frames were dropped, for the caller's log line.
export function abandonBackgroundRolls() {
  const dropped = diceContextStack.length
  if (!dropped) return 0
  diceContextStack.length = 0
  restoreRollEvaluate?.()
  return dropped
}
