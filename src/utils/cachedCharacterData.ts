import { clearActorSnapshotsForServer } from '@/utils/actorCache'
import { clearChatCacheForServer } from '@/utils/chatCache'
import { clearImageCacheForServer } from '@/api/imageCache'
import { clearLastCharacterId } from '@/utils/utilities'

// Everything a server's characters leave behind on this device, in one place:
// the actor snapshots, the chat tail + read markers, the cached portraits/token
// art, and the remembered character selection.
//
// Two paths must leave none of it: forgetting a server (a re-add has to start
// clean) and signing out of one (the next person to sign in on this device is a
// different Foundry user, and must not find the previous user's sheets waiting
// on disk). Both call this so neither can drift from the other as new caches
// are added.
//
// Best-effort and non-rejecting — every underlying helper swallows its own
// failures (missing IndexedDB, unreadable cache dir), so a caller that can't
// wait may leave the promise unawaited without risking an unhandled rejection.
//
// Callers holding *in-memory* character state must drop it (and cancel any
// debounced cache writers) before calling this: a trailing-edge snapshot or
// chat write landing after the delete would file the data straight back in.
export function clearCachedCharacterData(origin: string): Promise<void> {
  clearLastCharacterId(origin)
  return Promise.all([
    clearActorSnapshotsForServer(origin),
    clearChatCacheForServer(origin),
    clearImageCacheForServer(origin)
  ]).then(() => undefined)
}
