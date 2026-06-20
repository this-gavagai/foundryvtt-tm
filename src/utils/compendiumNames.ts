import { getCompendiumItem } from '@/api/actionRpc'

// Resolve a compendium document's display name from its UUID, for label-less
// @UUID[...] links (PF2e omits the label when it equals the document name, and
// the client only learns the name via the compendium RPC). Results are cached
// for the session and in-flight requests deduped, so the same linked document
// shown across multiple descriptions is fetched at most once.
const nameCache = new Map<string, string>()
const inFlight = new Map<string, Promise<string | undefined>>()

export function resolveCompendiumName(uuid: string): Promise<string | undefined> {
  const cached = nameCache.get(uuid)
  if (cached !== undefined) return Promise.resolve(cached)
  let pending = inFlight.get(uuid)
  if (!pending) {
    pending = getCompendiumItem(uuid)
      .then((result) => {
        const name = result.compendiumItem?.name
        if (name) nameCache.set(uuid, name)
        return name
      })
      .catch(() => undefined)
      .finally(() => inFlight.delete(uuid))
    inFlight.set(uuid, pending)
  }
  return pending
}
