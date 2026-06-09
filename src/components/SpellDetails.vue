<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Consumable, Spell, SpellcastingEntry } from '@/composables/character'
import type { SpellInfo } from '@/utils/spellcasting'

import ModifierList from '@/components/ModifierList.vue'
import ParsedDescription from '@/components/ParsedDescription.vue'

defineProps<{
  entry?: SpellcastingEntry
  item?: Spell | Consumable
  spell?: Spell
  consumable?: Consumable
  spellInfo?: SpellInfo
  labels?: Record<string, string>
  spellRollData: Record<string, unknown>
  consumableSpellRollData: Record<string, unknown>
}>()

const description = ref<InstanceType<typeof ParsedDescription>>()
const activeRoll = computed(() => description.value?.activeRoll)

defineExpose({ activeRoll })
</script>

<template>
  <div data-component="SpellDetails">
    <template v-if="entry && !item">
      <ModifierList :modifiers="entry.spellAttackModifiers" />
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
