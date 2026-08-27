import type { CheckRollHandler } from './types'
import { localizeOr } from '@/foundry/globals'

export const handleFlat: CheckRollHandler = ({ source, actor, args }) => {
  const label = localizeOr('PF2E.FlatCheck', 'Flat Check')
  const dc = (args.options as { dc?: number }).dc ?? 11
  // The rolling character, not an empty stand-in. `{}` cast to ActorPF2e happened
  // to work because a flat check's total comes entirely from the (empty)
  // StatisticModifier passed here, so nothing read off the actor — but it is the
  // silent-wrong-number failure mode systemCompat exists to warn about, one PF2e
  // refactor away, and it left the chat card with no speaker. Passing the real
  // actor attributes the card like every other roll from a tablet; the total is
  // unaffected, since the modifier list is still empty.
  return source.pf2e.Check.roll(new source.pf2e.StatisticModifier(label, []), {
    actor,
    type: 'flat-check',
    dc: { value: dc, visible: true },
    options: new Set(['flat-check']),
    createMessage: true,
    skipDialog: true
  })
}
