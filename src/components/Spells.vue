<script setup lang="ts">
// todo: heightened spells
// todo: prepared spells
// todo: wands
// todo: prevent casting if depleted
import { inject } from 'vue'
import {
  capitalize,
  makeTraits,
  makeActionIcons,
  makePropertiesHtml,
  removeUUIDs
} from '@/utils/utilities'
import { useServer } from '@/utils/server'
import Counter from '@/components/Counter.vue'

const { socket } = useServer()
const props = defineProps(['actor'])
const infoModal: any = inject('infoModal')
const actor: any = inject('actor')

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
        : s.system.level.value === level && !s.system.traits.value.includes('cantrip')
    })
  return spells
}

const infoSpell = (id: string) => {
  const spell = actor.value?.items.find((x: any) => x._id === id)
  console.log('Spell: ', spell)
  infoModal.value?.open({
    title: `${spell.name}
      <span class="text-2xl absolute pl-1 -mt-[.3rem]">
        ${makeActionIcons(spell.system.time.value)}
      </span>`,
    description:
      (spell.system.traits.value.includes('cantrip')
        ? `Cantrip`
        : `Rank ${spell.system.level.value}`) +
      ` <span class="text-sm">(${capitalize(spell.system.traits.rarity)})</span>`,
    body:
      makeTraits(spell.system.traits.value) +
      makePropertiesHtml(spell) +
      removeUUIDs(spell.system.description.value),
    iconPath: spell.img,
    actionButtons: [
      {
        actionParams: {
          action: 'castSpell',
          id: id,
          characterId: actor.value?._id,
          slotId: null,
          level: spell.system.level.value
        },
        actionMethod: (params: {}) => {
          // todo: manage slotId (for prepared) and level (for heighted) as params
          socket.value.emit('module.tablemate', params)
          infoModal.value.close()
        },
        buttonClasses: 'bg-blue-200 hover:bg-blue-300',
        buttonText: 'Cast!'
      }
    ]
  })
}
</script>
<template>
  <div>
    <!-- Spell Sources -->
    <ul class="">
      <li
        v-for="location in actor.items.filter((x: any) => x.type === 'spellcastingEntry')"
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
            <ul class="">
              <li v-for="spell in getSpellsForLocationAndLevel(location._id, level)">
                <div class="text-md">
                  <span @click="infoSpell(spell._id)" class="cursor-pointer">
                    <span>{{ spell.name }}</span>
                    <span class="pl-1 text-md pf2-icon">{{
                      spell.system.time.value.replace('to', ' - ')
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
</template>