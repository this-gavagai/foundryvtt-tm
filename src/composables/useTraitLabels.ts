import { useInjectedActor } from '@/composables/injectKeys'
import { formatTraitLabel } from '@/utils/traitLabels'

// Resolve PF2e trait/rarity slugs to their world-locale display labels using
// the map Foundry localizes onto the character (see localizeTraitLabels).
// Item data (rarity, traits) is localized Foundry-side, not via vue-i18n.
export function useTraitLabels() {
  const { traitLabels } = useInjectedActor()
  const labelFor = (slug?: string) => (slug ? formatTraitLabel(slug, traitLabels.value ?? {}) : '')
  return { labelFor }
}
