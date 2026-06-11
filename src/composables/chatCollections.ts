// Foundry surfaces collections (users, messages, scene tokens) in several
// shapes depending on whether the payload is a live document collection or a
// plain serialized snapshot. This normalizes any of them to a plain array.
// Lives in its own leaf module so both useChatMessages and useChatVisibility can
// share it without an import cycle.

export type CollectionLike<T> =
  | T[]
  | {
      contents?: T[]
      values?: () => IterableIterator<T>
    }
  | undefined

export function collectionToArray<T>(source: CollectionLike<T>): T[] {
  if (!source) return []
  if (Array.isArray(source)) return source
  if (Array.isArray(source.contents)) return source.contents
  if (typeof source.values === 'function') return Array.from(source.values())
  return []
}
