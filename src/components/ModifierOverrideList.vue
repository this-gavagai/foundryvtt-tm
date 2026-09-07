<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SignedNumber } from '@/utils/formatters'
import type { Modifier } from '@/composables/character'
import type { ModifierControls } from '@/composables/useModifierOverrides'

const { t, te } = useI18n()

const props = defineProps<{
  modifiers?: Modifier[]
  // Everything the panel needs to resolve and toggle the list, as ONE object.
  // Threading `effectiveEnabled`, `isManuallyActivated`, `isManuallyDeactivated`,
  // `isStackingLoser` and `onToggle` as five separate props is what made
  // StrikeDetails exist mostly to forward them, and what made a second, poorer
  // copy of this component (`ModifierList`) cheaper than wiring this one up.
  controls: ModifierControls
  toggleable?: boolean
  // Whether dice-based entries (sneak attack, deadly, …) can be toggled too.
  // Opt-in per context: the Foundry-side override hooks cover strike damage
  // dice (DamageDicePF2e.applyAlterations), but not blast or spell dice.
  diceToggleable?: boolean
  showDamageType?: boolean
}>()

// `hideIfDisabled` is honoured only where the row cannot be acted on.
//
// It exists for a modifier that is noise when off — but a row the player can
// TAP is never noise, and hiding one means the panel offers no way to reach it.
// That used to be a per-call-site flag (`showAll`), passed always by the strike
// panel, only in the damage phase by the spell panel, and never by the stat box,
// so whether a modifier existed depended on which modal you opened it from.
//
// A row the player has already touched always shows, so nothing can vanish under
// its own toggle.
const rows = computed(() => {
  const controls = props.controls
  return (
    (props.modifiers ?? [])
      .map((mod, index) => ({ mod, index }))
      // The same modifier seen twice. PF2e keeps one and discards the rest, so a
      // second copy names nothing the character has.
      .filter(({ index }) => !controls.isSuperseded(index))
      .filter(
        ({ mod, index }) =>
          props.toggleable ||
          mod.enabled ||
          !mod.hideIfDisabled ||
          controls.isManuallyActivated(mod) ||
          controls.isManuallyDeactivated(mod) ||
          controls.isOutranked(index)
      )
  )
})

const gridClass = computed(() =>
  props.showDamageType ? 'grid-cols-[2.5rem_6rem_1fr_auto]' : 'grid-cols-[2.5rem_6rem_1fr]'
)

// PF2e's seven modifier types are a closed vocabulary and pure UI chrome, so
// they belong in the app's own lang files rather than reading `[circumstance]`
// to a reader of any locale. An unknown type (homebrew, a system addition)
// falls through to its slug rather than to a missing-key marker.
function typeLabel(type: string): string {
  const key = `modifierTypes.${type}`
  return te(key) ? t(key) : type
}

function canToggle(mod: Modifier) {
  if (!props.toggleable) return false
  // No slug, no override key: `toggleModifier` cannot record the tap and the
  // Foundry side has nothing to match against. Offering the affordance anyway
  // gave the row a pointer cursor and a press animation for nothing.
  if (!mod.slug) return false
  if (mod.modifier !== undefined) return true
  return !!props.diceToggleable && mod.diceNumber !== undefined
}

// Keyed on the MECHANISM, not the source. `enableOptions` means tapping this row
// declares a condition and lets PF2e decide — true of a skill action's own
// modifiers, lifted GM-side, and of the rule engine's conditionals alike, which
// is why where the row came from is not carried this far.
function isCondition(mod: Modifier): boolean {
  return !!mod.enableOptions?.length
}

function rowTitle(mod: Modifier, index: number): string | undefined {
  if (props.controls.isOutranked(index)) return t('modifiers.outranked')
  if (isCondition(mod)) return t('modifiers.declaredCondition')
  return undefined
}

function toggle(mod: Modifier) {
  if (canToggle(mod)) props.controls.toggleModifier(mod)
}
</script>

<template>
  <ul>
    <li
      v-for="{ mod, index } in rows"
      data-part="modifier"
      :data-disabled="
        (!controls.effectiveEnabled(mod) &&
          !controls.isManuallyActivated(mod) &&
          !controls.isManuallyDeactivated(mod)) ||
        undefined
      "
      :data-manual-on="controls.isManuallyActivated(mod) || undefined"
      :data-manual-off="controls.isManuallyDeactivated(mod) || undefined"
      :data-stacking-loser="controls.isOutranked(index) || undefined"
      :data-condition="isCondition(mod) || undefined"
      :title="rowTitle(mod, index)"
      class="grid items-center gap-2 rounded-sm border border-transparent px-1 py-0.5"
      :class="[
        gridClass,
        {
          'cursor-pointer': canToggle(mod),
          'text-gray-300': !controls.effectiveEnabled(mod) && !controls.isManuallyDeactivated(mod),
          'text-green-800 dark:text-green-400': controls.isManuallyActivated(mod),
          'text-red-700 line-through dark:text-red-300': controls.isManuallyDeactivated(mod),
          'line-through opacity-50': controls.isOutranked(index)
        }
      ]"
      :key="'mod_' + index + '_' + mod.slug"
      @click="toggle(mod)"
    >
      <div class="text-right">
        <span v-if="mod.modifier !== undefined">{{ SignedNumber.format(mod.modifier) }}</span>
        <span v-if="mod.diceNumber">{{ `${mod.diceNumber}${mod.dieSize}` }}</span>
      </div>
      <div
        data-part="modifier-type"
        class="overflow-hidden text-[0.65rem] tracking-wide text-ellipsis whitespace-nowrap uppercase opacity-60"
      >
        <template v-if="mod.type && mod.type !== 'untyped'">[{{ typeLabel(mod.type) }}]</template>
      </div>
      <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
      <div v-if="showDamageType && mod.damageType" class="text-sm opacity-70">
        ({{ mod.damageType }})
      </div>
    </li>
  </ul>
</template>
