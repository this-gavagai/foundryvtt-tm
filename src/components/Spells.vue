<script setup lang="ts">
// TODO: track spent status of prepared spells
// TODO: deal with flexible prepared casters
// TODO: sort spells for name and signature status
// todo: wands
// TODO: (bug?) spell DC tends to pull from actor.system.attributes?.classOrSpellDC since the spellcastingEntry dc is rarely (never?) defined. is this okay?

import type { Item, Actor } from '@/utils/pf2e-types'
import { inject, computed, ref } from 'vue'
import { capitalize, makeActionIcons, makePropertiesHtml, removeUUIDs } from '@/utils/utilities'

import Counter from '@/components/Counter.vue'
import InfoModal from '@/components/InfoModal.vue'

interface Spellbook {
  [key: string]: { [key: string]: [Item?] }
}

const infoModal = ref()
const actor: Actor | undefined = inject('actor')
const viewedItem = computed(
  () => actor?.value.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)
const spellbook = computed((): Spellbook => {
  let sb: Spellbook = {} // {location - level - spell}
  // set spellcastingEntry locations with empty levels template
  actor?.value.items
    ?.filter((i: Item) => i?.type === 'spellcastingEntry')
    .forEach((se: { _id: string }) => {
      const location = se._id
      // prettier-ignore
      sb[location] = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': [] }
    })

  // assign spells to spellbook levels
  for (const locationId of Object.keys(sb)) {
    const location = actor?.value.items.find((i: Item) => i._id === locationId)
    if (location?.system.prepared.value === 'prepared') {
      Object.values(location.system.slots).forEach((slot: any, slotLevel: number) => {
        const preparedSpells = slot.prepared.map(
          (slotSpell: any) => actor?.value.items.find((i: Item) => i._id === slotSpell.id)
        )
        const spellSlots = Object.assign(new Array(slot.max), preparedSpells)
        sb[locationId][slotLevel] = spellSlots
      })
    } else {
      const spellsForLocation = actor?.value.items.filter(
        (i: Item) => i.type === 'spell' && i.system.location.value === locationId
      )
      spellsForLocation?.forEach((s: Item) => {
        const level = s.system.traits.value.includes('cantrip') ? '0' : String(s.system.level.value)
        sb[locationId][level].push(s)
        // add signature spells by iterating through spellslots property
        if (s.system.location.signature) {
          Object.values(location?.system.slots).forEach((slot: any, slotLevel: number) => {
            if (slot.max && slotLevel > s.system.level.value) {
              sb[locationId][slotLevel].push(s)
            }
          })
        }
      })
    }
  }
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
              v-if="location.system?.prepared.value === 'focus'"
              class="relative bottom-[-5px] text-sm"
              :value="actor?.system.resources.focus.value"
              :max="actor?.system.resources.focus.max"
            />
            <Counter
              v-if="location.system?.prepared.value === 'charge'"
              class="relative bottom-[-5px] text-sm"
              :value="location.flags?.['pf2e-dailies']?.staff?.charges"
            />
          </span>
        </h3>
        <div>
          Spell DC
          {{ location.system.spelldc.dc || actor?.system.attributes?.classOrSpellDC?.value }}
        </div>
        <!-- Spell Levels -->
        <ul>
          <!-- <li v-for="level in getLevelsForLocation(location._id)" class="mt-2 first:mt-0"> -->
          <li
            v-for="(spells, level) in spellbook[location._id]"
            class="mt-2 first:mt-0"
            :class="{ hidden: !spells.length }"
          >
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
            <ul class="empty:hidden">
              <li v-for="(spell, index) in spells" class="flex justify-between">
                <div
                  class="text-md"
                  :class="{
                    'bg-blue-50':
                      spell?.system?.location?.signature &&
                      spell?.system?.level.value !== Number(level)
                  }"
                >
                  <span v-if="spell" @click="infoModal.open(spell?._id)" class="cursor-pointer">
                    <span>{{ spell?.name }}</span>
                    <span class="pl-1 text-md pf2-icon">{{
                      spell?.system?.time.value.replace('to', ' - ').replace('free', 'f')
                    }}</span>
                  </span>
                  <span v-else>(empty)</span>
                </div>
                <Counter
                  class="relative bottom-[-1px] text-sm"
                  v-if="location.system?.prepared.value === 'prepared'"
                  :value="location.system.slots['slot' + level].prepared[index].expended ? 0 : 1"
                  :max="1"
                />
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
          viewedItem?.system.traits.value.includes('cantrip')
            ? `Cantrip`
            : `Rank ${viewedItem?.system.level.value}`
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
