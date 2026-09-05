import type { UpdateCharacterDetailsArgs } from '@/types/api-types'
import { TM } from '@/api/protocol'

// A complete UPDATE_CHARACTER payload, so a test that cares about ONE field can
// override just that field and still hand the code under test the whole
// contract. Shared by the label-cache tests (utils and store) and by the
// server-switch reset, which all need a payload and none of which care about
// the actor on it.
export function labelPayload(
  over: Partial<UpdateCharacterDetailsArgs> = {}
): UpdateCharacterDetailsArgs {
  return {
    action: TM.UPDATE_CHARACTER,
    actorId: 'actor-1',
    actor: {},
    system: {},
    inventory: {},
    activeRules: [],
    elementalBlasts: null,
    spellcastingModifiers: {},
    rollOptionLabels: {},
    skillActions: [],
    uuid: 'uuid-1',
    userId: 'user-1',
    ...over
  }
}
