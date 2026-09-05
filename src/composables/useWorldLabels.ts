import { computed, type ComputedRef, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { TablemateActor } from '@/types/character-types'
import { useLabelCatalogsStore } from '@/stores/labelCatalogs'

// The label reads every actor model shares, in one place.
//
// Characters, familiars and NPCs each expose the same four label fields, and all
// four used to be read off the actor — which meant they existed only for an
// actor a GM had serialized. They now come from the world catalog
// (stores/labelCatalogs), so they are the same for every actor and survive with
// no GM online.
//
// Two of them still need the actor, for reasons worth keeping straight:
//
//   * `languages` is per-actor DATA resolved through a world catalog. The slugs
//     are the actor's own (plain source data, present even on the world-dump
//     fallback path); only the naming is world-scoped.
//   * `rollOptionLabels` layers the actor's `item.slug → item.name` pairs on top
//     of the catalog. These are genuinely per-actor — two actors can hold
//     differently-named items with the same slug — and both halves are source
//     data, so deriving them here is both more correct than a shared map and
//     free of any round trip.

export interface WorldLabels {
  traitLabels: ComputedRef<Record<string, string>>
  iwrLabels: ComputedRef<Record<string, string>>
  proficiencyLabels: ComputedRef<Record<string, string>>
  rollOptionLabels: ComputedRef<Record<string, string>>
  languages: ComputedRef<string[]>
  // Interval key → the whole "per day" phrase. Handed to makeAction so a
  // limited-use ability can render its frequency without the module composing
  // one string per ability per refresh.
  frequencyLabels: ComputedRef<Record<string, string>>
}

type ActorRef = Ref<TablemateActor | undefined>

export function useWorldLabels(actor: ActorRef): WorldLabels {
  const { catalogs } = storeToRefs(useLabelCatalogsStore())

  const traitLabels = computed(() => catalogs.value.traits)
  const iwrLabels = computed(() => catalogs.value.iwr)
  const proficiencyLabels = computed(() => catalogs.value.proficiencies)
  const frequencyLabels = computed(() => catalogs.value.frequencies)

  const rollOptionLabels = computed(() => {
    const base = catalogs.value.rollOptions
    const items = actor.value?.items
    if (!items) return base
    // Item names last: an item in THIS actor's inventory is the more specific
    // answer for its own slug than anything the world catalog holds.
    const named: Record<string, string> = { ...base }
    for (const item of items) {
      const slug = (item as { system?: { slug?: string | null } }).system?.slug
      if (slug && item.name) named[slug] = item.name
    }
    return named
  })

  const languages = computed(() => {
    const details = actor.value?.system?.details as { languages?: { value?: string[] } } | undefined
    const slugs = details?.languages?.value ?? []
    // An unknown slug reads back as itself — the same fallback the Foundry side
    // used when a language had no CONFIG entry.
    return slugs.map((slug) => catalogs.value.languages[slug] ?? slug)
  })

  return { traitLabels, iwrLabels, proficiencyLabels, rollOptionLabels, languages, frequencyLabels }
}
