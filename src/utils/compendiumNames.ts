import { getCompendiumName } from '@/api/compendium'

// Resolve a linked document's display name from its UUID, for label-less
// @UUID[...] links (PF2e omits the label when it equals the referenced
// document's name, and the client only learns the name by reading the document).
// Covers both compendium entries and items embedded on a world actor — see
// api/compendium.getCompendiumName. Results are cached for the session and
// in-flight requests deduped, so the same linked document shown across multiple
// descriptions is fetched at most once.
const nameCache = new Map<string, string>()
const inFlight = new Map<string, Promise<string | undefined>>()

export function resolveCompendiumName(uuid: string): Promise<string | undefined> {
  const cached = nameCache.get(uuid)
  if (cached !== undefined) return Promise.resolve(cached)
  let pending = inFlight.get(uuid)
  if (!pending) {
    pending = getCompendiumName(uuid)
      .then((name) => {
        if (name) nameCache.set(uuid, name)
        return name
      })
      .catch(() => undefined)
      .finally(() => inFlight.delete(uuid))
    inFlight.set(uuid, pending)
  }
  return pending
}

// Fill in the link text of label-less @UUID[...] anchors under `root` — they
// render with a "…" placeholder flagged data-uuid-unresolved (see pf2eUuidHtml)
// because the name is only known after reading the referenced document. The flag
// is cleared before the async lookup so a re-entrant pass (a MutationObserver
// watching the same subtree sees our own text write) doesn't look it up twice.
export function fillUuidLinkLabels(root: ParentNode | null | undefined): void {
  root
    ?.querySelectorAll<HTMLAnchorElement>('a.content-link[data-uuid][data-uuid-unresolved]')
    .forEach((anchor) => {
      const uuid = anchor.dataset.uuid
      anchor.removeAttribute('data-uuid-unresolved')
      if (!uuid) return
      resolveCompendiumName(uuid).then((name) => {
        if (name) anchor.textContent = name
      })
    })
}
