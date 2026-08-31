// Everything a running handler owns that can OUTLIVE it.
//
// Handlers execute strictly one at a time (the dispatch chain in listener.ts)
// because several mechanisms read ambient top-of-stack state while one runs:
// preset dice faces, damage modifier overrides, chat attribution, and this
// client's own target selection. Serialization is what keeps two interleaved
// requests from reading each other's context.
//
// When the queue gives up on a handler that never settles, that serialization is
// exactly what it gives up: the next request starts while the hung one is still
// running, and whatever the hung one left on a stack is now what somebody else's
// roll reads. So each mechanism has to be torn down at the moment the queue moves
// on, rather than in a `finally` that may never run.
//
// This exists because that lesson was learned four separate times. Dice contexts
// and chat attribution each got an abandon path only after the bug was found in
// them; the target swap and the damage overrides were found still missing one
// during a later audit, having been written after the rule was established and
// simply not told about it. The dispatch loop ended up calling four teardowns by
// hand and assembling their counts into a log line by hand — four parallel
// structures keyed by nothing, exactly the shape rpcTable.ts exists to kill.
//
// Keyed by a union, for rpcTable's reason: a mechanism added to AmbientState
// without a teardown is a compile error, not a leak nobody notices until one
// player's modifier toggles start landing on the GM's own rolls.
//
// THE RULE, for whoever adds the fifth: if your mechanism pushes a frame that a
// handler is expected to pop, it belongs here. The `with*` wrapper's own
// `finally` is not enough — a hung handler never reaches it.

import { logger } from '@/utils/utilities'
import { abandonChatOrigin, type ChatOrigin } from './chatOrigin'
import { abandonBackgroundRolls } from './backgroundRoll'
import { abandonMirroredTargets } from './utils/target'
import { abandonDamageModifierOverrides } from './handlers/checks/modifierOverrides'

export type AmbientState = 'chatOrigin' | 'diceResults' | 'targetSwap' | 'damageOverrides'

// Every teardown takes the abandoned request's chat-origin frame — the only
// per-request handle any of them needs — and answers how many frames it dropped.
// The three that own module-level stacks ignore the argument.
type Teardown = (origin: ChatOrigin) => number

const TEARDOWNS: Record<AmbientState, Teardown> = {
  chatOrigin: (origin) => abandonChatOrigin(origin),
  diceResults: () => abandonBackgroundRolls(),
  targetSwap: () => abandonMirroredTargets(),
  damageOverrides: () => abandonDamageModifierOverrides()
}

// What each teardown dropped, or 'failed' if it threw. Shaped for a log line:
// the dispatch timeout reports it verbatim.
export type AbandonReport = Record<AmbientState, number | 'failed'>

// Tear down every piece of ambient state belonging to a request the dispatch
// queue has given up on.
//
// Each teardown is isolated: this runs from the queue's timeout, where one
// mechanism throwing must not leave the other three standing — a mechanism left
// standing is the entire failure this exists to prevent. Never throws, for the
// same reason.
export function abandonRequestContext(origin: ChatOrigin): AbandonReport {
  const report = {} as AbandonReport
  for (const name of Object.keys(TEARDOWNS) as AmbientState[]) {
    try {
      report[name] = TEARDOWNS[name](origin)
    } catch (error) {
      report[name] = 'failed'
      logger.error('TABLEMATE: could not abandon ambient state', name, error)
    }
  }
  return report
}
