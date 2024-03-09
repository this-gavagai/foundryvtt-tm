<script setup lang="ts">
// todo: heightened spells
// todo: prepared spells
// todo: wands
// todo: prevent casting if depleted
// todo: refactor spellbook to use computed variable
import { inject, computed, ref } from 'vue'
import { capitalize, makeActionIcons, makePropertiesHtml, removeUUIDs } from '@/utils/utilities'
import Counter from '@/components/Counter.vue'
import InfoModal from '@/components/InfoModal.vue'

const infoModal = ref()
const actor: any = inject('actor')
const viewedItem = computed(
  () => actor.value.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)

function getLevelsForLocation(location: string): [any] {
  return actor.value?.items
    .filter((i: any) => i.type === 'spell' && i.system.location.value === location)
    .map((s: any) => (s.system.traits.value.includes('cantrip') ? 0 : s.system.level.value))
    .sort()
    .filter((itm: any, pos: number, ary: [any]) => !pos || itm != ary[pos - 1])
}
function getSpellsForLocationAndLevel(location: string, level: number): [any] {
  const spells = actor.value?.items
    .filter((i: any) => i.type === 'spell' && i.system.location.value === location)
    .filter((s: any) => {
      return level === 0
        ? s.system.traits.value.includes('cantrip')
        : (s.system.level.value === level ||
            (s.system.level.value < level && s.system.location.signature)) &&
            !s.system.traits.value.includes('cantrip')
    })
  return spells
}
</script>
<template>
  <div class="px-6 py-4">
    <!-- Spell Sources -->
    <ul class="">
      <li
        v-for="location in actor?.items?.filter((x: any) => x?.type === 'spellcastingEntry')"
        class="mt-4 first:mt-0"
      >
        <h3 class="">
          <span class="underline text-xl">
            {{ location.name }}
          </span>
          <span class="pl-1 text-xs">
            <Counter
              v-if="location.system?.prepared.value === 'focus'"
              :value="actor.system.resources.focus.value"
              :max="actor.system.resources.focus.max"
            />
            <Counter
              v-if="location.system?.prepared.value === 'charge'"
              :value="location.flags?.['pf2e-staves']?.charges"
            />
          </span>
        </h3>
        <!-- Spell Levels -->
        <ul>
          <li v-for="level in getLevelsForLocation(location._id)" class="mt-2 first:mt-0">
            <h4 class="text-sm italic">
              <span class="pr-1">
                {{ level == 0 ? 'Cantrips' : 'Rank ' + level }}
              </span>
              <Counter
                v-if="location.system?.prepared.value === 'spontaneous'"
                class="text-xs"
                :value="location.system.slots['slot' + level].value"
                :max="location.system.slots['slot' + level].max"
              />
            </h4>
            <!-- Spells -->
            <ul>
              <li v-for="spell in getSpellsForLocationAndLevel(location._id, level)">
                <div class="text-md">
                  <span @click="infoModal.open(null, spell._id)" class="cursor-pointer">
                    <span>{{ spell.name }}</span>
                    <span class="pl-1 text-md pf2-icon">{{
                      spell.system.time.value.replace('to', ' - ').replace('free', 'f')
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
      :traits="viewedItem?.system.traits.value"
    >
      <template #title>
        {{ viewedItem?.name }}
        <span
          class="text-2xl absolute pl-1 -mt-[.3rem]"
          v-html="
            makeActionIcons(viewedItem?.system.time.value.replace('to', ' - ').replace('free', 'f'))
          "
        ></span>
      </template>
      <template #description>
        {{
          (viewedItem.system.traits.value.includes('cantrip')
            ? `Cantrip`
            : `Rank
        ${viewedItem.system.level.value}`) +
          `
        `
        }}
        <span class="text-sm">{{ capitalize(viewedItem.system.traits.rarity) }}</span>
      </template>
      <template #body>
        <div v-html="makePropertiesHtml(viewedItem)"></div>
        <div v-html="removeUUIDs(viewedItem.system.description.value)"></div>
      </template>
    </InfoModal>
  </Teleport>
</template>
