import { useListenersStore } from '@/stores/listenersOnline'
import { useVersionCompatStore } from '@/stores/versionCompat'
import { useGmPolicyStore } from '@/stores/gmPolicy'
import { useTokenRingStore } from '@/stores/tokenRing'
import { useTargetHelperStore } from '@/stores/targetHelper'

// Everything the connected world told us about itself, dropped in one place.
//
// All of it arrives on a module announcement or a proxy push, so none of it is
// re-derived on a server/user switch — it simply persists until the new world's
// module happens to speak. Carried over, the new world inherits the old one's
// GM presence (roll buttons live against a client that cannot answer), its
// manual-roll policy, its capability flags, and its token ring art.
//
// It lives here rather than beside either of its callers because there are two,
// and they cover different halves of "the world changed":
//
//   serverAddress.activate()  — a switch to a different origin, known before
//                               any network happens, whether or not the new
//                               server ever answers.
//   the onUserChanged hook    — a session handshake naming a different user,
//                               which also covers re-logging in as someone else
//                               on the SAME origin, where no activate() fires.
//
// Neither is a superset of the other. Hooking the reset only to the handshake
// left a switch to an unreachable server holding the previous world's presence
// and policy indefinitely — GM presence ages out on its own TTL, but the
// capability flags, the manual-roll policy and the ring art have no timeout at
// all and would sit there until the new world's module happened to announce.
export function resetWorldScopedStores() {
  useListenersStore().reset()
  useVersionCompatStore().reset()
  useGmPolicyStore().reset()
  useTokenRingStore().reset()
  // Mirrored targets belong to one proxy in one world. Carrying them across a
  // server/user switch would leave the sheet holding token ids that resolve to
  // nothing — or, worse, to something.
  useTargetHelperStore().reset()
}
