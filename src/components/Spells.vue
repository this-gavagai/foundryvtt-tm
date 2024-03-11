<script setup lang="ts">
// todo: reorganize to use spellcastingEntry slots
// todo: prepared spells
// todo: wands
// todo: prevent casting if depleted

import type { Item } from '@/utils/pf2e-types'
import { inject, computed, ref } from 'vue'
import { capitalize, makeActionIcons, makePropertiesHtml, removeUUIDs } from '@/utils/utilities'
import Counter from '@/components/Counter.vue'
import InfoModal from '@/components/InfoModal.vue'

const infoModal = ref()
const actor: any = inject('actor')
const viewedItem = computed(
  () => actor.value.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)

interface Spellbook {
  [key: string]: { [key: string]: [Item?] }
}
const spellbook = computed((): Spellbook => {
  let sb: Spellbook = {} // {location - level - spell}

  // add locations, levels,  then spell items
  actor.value.items
    ?.filter((i: Item) => i?.type === 'spellcastingEntry')
    .forEach((se: { _id: string }) => {
      const location = se._id
      sb[location] = {}
      actor.value.items
        .filter((i: Item) => i.type === 'spell' && i.system.location.value === location)
        .map((s: Item) =>
          s.system.traits.value.includes('cantrip') ? '0' : String(s.system.level.value)
        )
        .sort()
        .filter((itm: number, pos: number, ary: [number]) => !pos || itm != ary[pos - 1])
        .forEach((level: string) => {
          // levels
          sb[location][level] = []
          actor.value.items
            .filter((i: Item) => i.type === 'spell' && i.system.location.value === location)
            .filter((s: Item) => {
              return level === '0'
                ? s.system.traits.value.includes('cantrip')
                : (s.system.level.value === Number(level) ||
                    (s.system.level.value < Number(level) && s.system.location.signature)) &&
                    !s.system.traits.value.includes('cantrip')
            })
            .forEach((s: Item) => {
              sb[location][level].push(s)
            })
        })
    })
  return sb
})
</script>
<template>
  <div class="px-6 py-4">
    <!-- Spell Sources -->
    <ul class="">
      <li
        v-for="location in actor?.items?.filter((x: Item) => x?.type === 'spellcastingEntry')"
        class="mt-4 first:mt-0"
      >
        <h3 class="flex justify-between align-bottom bg-gray-300">
          <span class="underline text-xl">
            {{ location.name }}
          </span>
          <span class="pl-1 text-xs">
            <Counter
              class="relative bottom-[-5px] text-sm"
              v-if="location.system?.prepared.value === 'focus'"
              :value="actor.system.resources.focus.value"
              :max="actor.system.resources.focus.max"
            />
            <Counter
              class="relative bottom-[-5px] text-sm"
              v-if="location.system?.prepared.value === 'charge'"
              :value="location.flags?.['pf2e-dailies']?.staff?.charges"
            />
          </span>
        </h3>
        <div>
          Spell DC
          {{ location.system.spelldc.dc || actor.system.attributes?.classOrSpellDC?.value }}
        </div>
        <!-- Spell Levels -->
        <ul>
          <!-- <li v-for="level in getLevelsForLocation(location._id)" class="mt-2 first:mt-0"> -->
          <li v-for="(spells, level) in spellbook[location._id]" class="mt-2 first:mt-0">
            <h4 class="text-sm italic flex justify-between align-bottom bg-gray-200">
              <span class="pr-1">
                {{ level == '0' ? 'Cantrips' : 'Rank ' + level }}
              </span>
              <Counter
                class="relative bottom-[-1px] text-sm"
                v-if="location.system?.prepared.value === 'spontaneous'"
                :value="location.system.slots['slot' + level].value"
                :max="location.system.slots['slot' + level].max"
              />
            </h4>
            <!-- Spells -->
            <ul>
              <li v-for="spell in spells">
                <div class="text-md">
                  <span @click="infoModal.open(spell?._id)" class="cursor-pointer">
                    <span>{{ spell?.name }}</span>
                    <span class="pl-1 text-md pf2-icon">{{
                      spell?.system.time.value.replace('to', ' - ').replace('free', 'f')
                    }}</span>
                  </span>
                </div>
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="viewedItem?.img"
      :traits="viewedItem?.system?.traits.value"
    >
      <template #title>
        {{ viewedItem?.name }}
        <span
          class="text-2xl absolute pl-1 -mt-[.3rem]"
          v-html="
            makeActionIcons(
              viewedItem?.system?.time.value.replace('to', ' - ').replace('free', 'f')
            )
          "
        ></span>
      </template>
      <template #description>
        {{
          (viewedItem?.system.traits.value.includes('cantrip')
            ? `Cantrip`
            : `Rank
        ${viewedItem?.system.level.value}`) +
          `
        `
        }}
        <span class="text-sm">{{ capitalize(viewedItem?.system.traits.rarity) }}</span>
      </template>
      <template #body>
        <div v-html="makePropertiesHtml(viewedItem)"></div>
        <div v-html="removeUUIDs(viewedItem?.system.description.value)"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
