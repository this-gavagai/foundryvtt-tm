import type {
  ActorPF2e,
  CharacterPF2e,
  GamePF2e,
  Modifier,
  StatisticRollParameters,
  TokenPF2e
} from '@7h3laughingman/pf2e-types'
import type { RollCheckArgs } from '@/types/api-types'

// Context every roll-check handler receives. The orchestrator (foundryRollCheck)
// builds this once per request; each handler reads what it needs.
export type CheckRollContext = {
  source: GamePF2e
  actor: CharacterPF2e
  args: RollCheckArgs
  // Shared param blob that strike / blast handlers spread into PF2e roll calls.
  // Statistic handlers (save/skill/…) override `target` with targetActorProxy
  // via statisticParams() — see CheckRollContext.targetActorProxy below.
  params: {
    modifiers: Modifier[]
    target: TokenPF2e | null
    skipDialog: boolean
    event: PointerEvent
    identifier: string
  }
  // Used by handlers that go through PF2e's Statistic API. The proxy
  // intercepts getActiveTokens on the player's chosen target actor and
  // returns the right token — without touching game.user.targets, which on
  // the GM machine is the GM's own UI state, not the calling player's.
  targetActorProxy: ActorPF2e | null
}

export type CheckRollHandler = (ctx: CheckRollContext) => unknown

// Build the parameter blob the PF2e Statistic API expects. Overrides
// params.target with the actor proxy so getActiveTokens returns the player's
// chosen token. See CheckRollContext.targetActorProxy for the cross-user
// rationale (game.user.targets is the GM's UI on the handler side).
export function statisticParams(ctx: CheckRollContext): StatisticRollParameters {
  return {
    ...ctx.args.options,
    ...ctx.params,
    ...(ctx.targetActorProxy ? { target: ctx.targetActorProxy } : {})
  } as StatisticRollParameters
}
