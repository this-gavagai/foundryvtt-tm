import type { ActorPF2e, GamePF2e, TokenPF2e } from '@7h3laughingman/pf2e-types'

type TokenDocLike =
  | NonNullable<ReturnType<NonNullable<GamePF2e['scenes']['active']>['tokens']['get']>>
  | null

export type ResolvedTarget = {
  // The token document on the active scene, or null if no valid target.
  tokenDoc: TokenDocLike
  // The placed Token object (right for strike/blast `target` params).
  token: TokenPF2e | null
  // A Proxy over the target's Actor that intercepts getActiveTokens to return
  // the right token(s). Used by handlers that go through PF2e's Statistic API.
  //
  // The handler runs on the GM's machine, so game.user.targets is the GM's UI
  // state — not the calling player's. The player's chosen target arrives via
  // the wire; this proxy lets us drive PF2e's target-resolution path without
  // mutating any user's targeting state.
  actorProxy: ActorPF2e | null
}

export function resolveTarget(
  source: GamePF2e,
  tokenIds: string[] | undefined
): ResolvedTarget {
  const tokenDoc = tokenIds?.map((t: string) => source.scenes.active?.tokens.get(t))[0] ?? null
  const actor = tokenDoc?.actor ?? null
  const token = tokenDoc?.object ?? null
  const actorProxy =
    actor && token
      ? (new Proxy(actor, {
          get(obj: ActorPF2e, prop: string | symbol) {
            if (prop === 'getActiveTokens') {
              return (_linked?: boolean, document?: boolean) =>
                document ? [tokenDoc] : [token]
            }
            const val = (obj as ActorPF2e & Record<string | symbol, unknown>)[prop]
            return typeof val === 'function'
              ? (val as (...a: unknown[]) => unknown).bind(obj)
              : val
          }
        }) as ActorPF2e)
      : null
  return { tokenDoc, token, actorProxy }
}
