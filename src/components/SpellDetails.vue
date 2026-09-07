<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Consumable, Spell, SpellcastingEntry } from '@/composables/character'
import type { SpellInfo } from '@/utils/spellcasting'

import ModifierOverrideList from '@/components/ModifierOverrideList.vue'
import ParsedDescription from '@/components/ParsedDescription.vue'
import { useModifierOverrides } from '@/composables/useModifierOverrides'

const props = defineProps<{
  entry?: SpellcastingEntry
  item?: Spell | Consumable
  spell?: Spell
  consumable?: Consumable
  spellInfo?: SpellInfo
  labels?: Record<string, string>
  spellRollData: Record<string, unknown>
  consumableSpellRollData: Record<string, unknown>
}>()

// Read-only: this panel describes the entry's spell attack, it does not roll it
// — the roll (and its toggles) live in SpellRollModal. Resolving the list
// through the same composable anyway is what let the second, cut-down copy of
// the panel go: it showed the same modifiers with no type tags and no stacking
// marks, so an outranked row read as a contributing one.
const attackControls = useModifierOverrides(computed(() => props.entry?.spellAttackModifiers))

const description = ref<InstanceType<typeof ParsedDescription>>()
const activeRoll = computed(() => description.value?.activeRoll)

defineExpose({ activeRoll })
</script>

<template>
  <div data-component="SpellDetails">
    <template v-if="entry && !item">
      <ModifierOverrideList :modifiers="entry.spellAttackModifiers" :controls="attackControls" />
    </template>
    <template v-else-if="!entry || item">
      <div class="flex gap-2 empty:hidden">
        <div v-if="spell?.system?.range">
          <span class="font-bold">{{ $t('spells.range') }}:</span>
          {{ spell?.system?.range }}
        </div>
        <div v-if="spell?.system?.area?.value && spell?.system?.area?.type">
          <span class="font-bold">{{ $t('spells.area') }}:</span>
          {{ spell?.system?.area?.value }}-{{ $t('spells.foot') }}
          {{ spell?.system?.area?.type }}
        </div>
        <div v-if="spell?.system?.target">
          <span class="font-bold">{{ $t('spells.target') }}:</span>
          {{ spell?.system?.target }}
        </div>
      </div>
      <div class="flex [&:not(:has(span))]:hidden">
        <label class="font-bold">{{ $t('spells.defense') }}:&nbsp;</label>
        <span v-if="spell?.system?.defense?.save?.statistic">
          <span v-if="spell?.system?.defense?.save?.basic">{{ $t('spells.basic') }}&nbsp;</span>
          <span class="capitalize">{{ spell?.system?.defense?.save?.statistic }}</span>
        </span>
        <span v-if="spell?.system?.traits?.value?.includes('attack')">{{ $t('spells.ac') }}</span>
      </div>
      <div v-if="spellInfo?.isConsumable">
        <h4 class="text-xl">{{ $t('spells.spellDetails') }}</h4>
        <ParsedDescription
          :text="consumable?.system.spell?.system?.description?.value"
          :labels="labels"
          :rollData="consumableSpellRollData"
          :itemId="consumable?._id ?? undefined"
        />
        <hr />
        <h4 class="pt-1 text-xl">{{ $t('spells.wandDetails') }}</h4>
      </div>
      <ParsedDescription
        ref="description"
        :text="item?.system.description?.value"
        :labels="labels"
        :rollData="spellRollData"
        :itemId="item?._id ?? undefined"
      />
    </template>
  </div>
</template>
