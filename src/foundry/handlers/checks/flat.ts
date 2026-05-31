import type { ActorPF2e } from '@7h3laughingman/pf2e-types'
import type { CheckRollHandler } from './types'

export const handleFlat: CheckRollHandler = ({ args }) => {
  const label = 'Generic Flat Check'
  const dc = (args.options as { dc?: number }).dc ?? 11
  return game.pf2e.Check.roll(new game.pf2e.StatisticModifier(label, []), {
    actor: {} as ActorPF2e,
    type: 'flat-check',
    dc: { value: dc, visible: true },
    options: new Set(['flat-check']),
    createMessage: true,
    skipDialog: true
  })
}
