<script setup lang="ts">
import type { Spell, SpellcastingEntry } from '@/composables/character'
import { isSlotCaster, isStrictPrepared, slotKey, type SpellInfo } from '@/utils/spellcasting'

import CounterWidget from '@/components/widgets/CounterWidget.vue'
import ActionIcons from '@/components/widgets/ActionIcons.vue'
import SpellRollButtons from '@/components/SpellRollButtons.vue'

// One "source → rank → spell list" block, shared by spellcasting entries and the
// staff. The entry-specific UI (slot counters, empty slots, prepared counters,
// signature heightening) is all gated on `entry`; a staff source leaves it
// undefined and those affordances fall away.
const props = defineProps<{
  dataSection: string
  title: string
  dc?: number
  ranks?: Record<string, (Spell | undefined)[]>
  entry?: SpellcastingEntry
  titleClickable?: boolean
}>()

const emit = defineEmits<{
  openEntry: []
  openSpell: [id: string | undefined, info: SpellInfo]
  openEmpty: [info: SpellInfo]
  pick: [
    spell: Spell,
    entry: SpellcastingEntry | undefined,
    rank: number,
    phase: 'attack' | 'damage',
    map: 0 | 1 | 2
  ]
}>()

// An entry cast carries its slot coordinates; a staff cast only needs the rank.
function spellInfo(rank: string, index: number): SpellInfo {
  return props.entry
    ? {
        entry: props.entry,
        entryId: props.entry._id,
        castingRank: Number(rank),
        castingSlot: index
      }
    : { fromStaff: true, castingRank: Number(rank) }
}
</script>
<template>
  <section :data-section="dataSection" class="break-inside-avoid-column">
    <h3 class="flex justify-between px-4 py-2 align-bottom">
      <span>
        <button
          v-if="titleClickable"
          type="button"
          class="cursor-pointer text-xl"
          @click="emit('openEntry')"
        >
          {{ title }}
        </button>
        <span v-else class="text-xl">{{ title }}</span>
        <span v-if="dc" class="text-xs"> (DC {{ dc }}) </span>
      </span>
      <slot name="headerCounter" />
    </h3>
    <!-- Spell Ranks -->
    <section
      v-for="(spells, rank) in ranks ?? {}"
      class="[section:not(.hidden)~&]:mt-3"
      :class="{ hidden: !spells.length }"
      :key="'rank' + rank"
    >
      <h4 class="flex justify-between px-4 align-bottom text-sm italic">
        <span class="pr-1">
          {{ rank == '0' ? $t('spells.cantrips') : $t('spells.rank', { n: rank }) }}
        </span>
        <CounterWidget
          v-if="entry && isSlotCaster(entry)"
          class="relative bottom-px -m-0.5 mr-2 h-4 pb-1 text-sm"
          :value="entry.system.slots?.[slotKey(rank)]?.value"
          :max="entry.system.slots?.[slotKey(rank)]?.max"
          editable
          :title="`${entry.name}: ${$t('spells.rank', { n: rank })}`"
          @change-count="(newTotal) => entry?.setSlotCount?.(Number(rank), newTotal)"
        />
      </h4>
      <!-- Spells -->
      <ul class="mb-1 empty:hidden">
        <li
          v-for="(spell, index) in spells"
          class="grid grid-cols-[1fr_auto] items-center gap-x-2 px-4 py-px min-[430px]:grid-cols-[1fr_auto_auto]"
          :key="spell?._id"
        >
          <!-- col 1, row 1 at all widths -->
          <div class="text-md min-w-0">
            <button
              v-if="spell"
              type="button"
              class="flex max-w-full cursor-pointer items-baseline overflow-hidden"
              @click="emit('openSpell', spell?._id, spellInfo(String(rank), index))"
            >
              <span class="truncate">
                <span
                  v-if="
                    spell?.system?.location?.signature &&
                    spell?.system.level?.value !== Number(rank)
                  "
                  >*</span
                >{{ spell?.name }}</span
              >
              <ActionIcons class="text-md ml-1 shrink-0" :actions="spell?.system?.time?.value" />
            </button>
            <button
              v-else-if="entry"
              type="button"
              class="cursor-pointer text-gray-500"
              @click="emit('openEmpty', spellInfo(String(rank), index))"
            >
              (empty)
            </button>
          </div>
          <!-- col 1 row 2 at narrow; col 2 row 1 at wide -->
          <div class="min-[430px]:col-span-1 min-[430px]:col-start-2 min-[430px]:row-start-1">
            <SpellRollButtons
              :spell="spell"
              :entry="entry"
              :rank="Number(rank)"
              @pick="(...args) => emit('pick', ...args)"
            />
          </div>
          <!-- col 2 row 1 at narrow; col 3 row 1 at wide -->
          <CounterWidget
            v-if="entry && isStrictPrepared(entry) && Number(rank) > 0"
            class="col-start-2 row-start-1 mr-2 h-3 self-center text-sm min-[430px]:col-start-3 [&>div]:mt-0"
            :value="
              entry.system.slots?.[slotKey(rank)]?.prepared?.[index]?.expended === false ? 1 : 0
            "
            :max="1"
            editable
            :title="`${$t('spells.rank', { n: rank })}: ${spell?.name}`"
            @change-count="
              (newTotal) =>
                entry?.setPrepared?.(
                  Number(rank),
                  index,
                  spell?._id ?? null,
                  newTotal ? false : true
                )
            "
          />
        </li>
      </ul>
    </section>
  </section>
</template>
