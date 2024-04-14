<script setup lang="ts">
// TODO: (feature) get modifiers onto skill actions (somehow?)
import type { Ref } from 'vue'
import type { Actor, Item } from '@/types/pf2e-types'
const props = defineProps(['actor'])
import { inject, ref, computed } from 'vue'
import { capitalize, removeUUIDs, printPrice, SignedNumber } from '@/utils/utilities'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import InfoModal from '@/components/InfoModal.vue'
import SkillSelector from './SkillSelector.vue'

const infoModal = ref()
const skillSelector = ref()

const actor = inject(useKeys().actorKey)!
const action: any = computed(
  () => actor.value?.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)
const { characterAction } = useApi()
// const options: any = computed(() => {
//   if (action.value.system?.slug === 'aid') return { statistic: skillSelector.value.selected.slug }
//   else return {}
// })
function doAction(slug: string) {
  // actionDefs.value.get(slug)['options'] = options
  console.log('here', skillSelector.value?.selected?.slug)
  characterAction(
    actor as Ref<Actor>,
    actionDefs.value.get(slug)?.alias ?? slug,
    actionDefs.value.get(slug)?.options
  ).then((r) => {
    infoModal.value.rollResultModal.open(r)
    infoModal.value.close()
  })
}

// TODO: (refactor+) computing this semi-constant value this way is Super ugly; approach actions differently
const actionDefs = computed(() => {
  return new Map<string, any>([
    ['administer-first-aid', { skill: 'medicine' }],
    [
      'aid',
      {
        skill: null,
        skillSelector: 'statistic',
        options: { statistic: skillSelector.value?.selected?.slug }
      }
    ],
    ['demoralize', { skill: 'intimidation' }],
    ['tumble-through', { skill: 'acrobatics' }],
    ['battle-medicine', { alias: 'legacy.treatWounds', skill: 'medicine' }],
    ['treat-wounds', { alias: 'legacy.treatWounds', skill: 'medicine' }],
    ['bon-mot', { skill: 'diplomacy' }],
    ['create-a-diversion', { skill: 'deception' }],
    ['disable-device', { skill: 'thievery' }],
    ['disarm', { skill: 'athletics' }],
    ['escape', { skill: 'athletics' }],
    ['feint', { skill: 'deception' }],
    ['grapple', { skill: 'athletics' }],
    ['hide', { skill: 'stealth' }],
    ['high-jump', { skill: 'athletics' }],
    ['long-jump', { skill: 'athletics' }],
    ['raise-a-shield', { skill: null }],
    ['reposition', { skill: 'athletics' }],
    ['rest-for-the-night', { skill: null }],
    ['sense-motive', { skill: 'perception' }],
    ['shove', { skill: 'athletics' }],
    ['sneak', { skill: 'stealth' }],
    ['trip', { skill: 'athletics' }]
  ])
})
</script>

<template>
  <div class="px-6 py-4" v-if="actor">
    <h3 class="underline text-2xl">Actions</h3>
    <ul>
      <li
        v-for="feat in actor.items
          ?.filter((i: Item) => i.system.actionType?.value === 'action')
          .filter(
            (i: Item) =>
              !i.system.traits.value.includes('skill') && !actionDefs.get(i.system.slug)?.skill
          )"
        class="cursor-pointer"
        @click="infoModal.open(feat._id)"
      >
        {{ feat.name }}
      </li>
    </ul>
    <h3 class="underline text-2xl pt-2">Reactions</h3>
    <ul>
      <li
        v-for="feat in actor.items?.filter((i: Item) => i.system.actionType?.value === 'reaction')"
        class="cursor-pointer"
        @click="infoModal.open(feat._id)"
      >
        {{ feat.name }}
      </li>
    </ul>
    <h3 class="underline text-2xl pt-2">Skill Actions</h3>
    <ul>
      <li
        v-for="feat in actor?.items
          ?.filter((i: Item) => i.system.actionType?.value === 'action')
          .filter(
            (i: Item) =>
              i.system.traits.value.includes('skill') || actionDefs.get(i.system.slug)?.skill
          )"
        class="cursor-pointer"
        @click="infoModal.open(feat._id)"
      >
        {{ feat.name }}
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal ref="infoModal" :imageUrl="action?.img" :traits="action?.system.traits.value">
      <template #title>
        {{ action?.name }}
      </template>
      <template #description>
        Level {{ action?.system.level?.value ?? 0 }}
        <span class="text-sm">({{ capitalize(action?.system?.traits?.rarity) }})</span>
      </template>
      <template #body>
        <div v-html="removeUUIDs(action?.system.description.value)"></div>
      </template>
      <template #actionButtons>
        <div class="flex align-items-center gap-2">
          <SkillSelector
            v-if="actionDefs.get(action?.system.slug)?.skillSelector"
            ref="skillSelector"
          />
          <button
            v-if="actor && actionDefs.get(action?.system.slug)"
            type="button"
            class="bg-blue-600 hover:bg-blue-500 text-white inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium focus:outline-none"
            @click="doAction(action?.system.slug)"
          >
            Roll
          </button>
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
@/composables/api@/composables@/types/pf2e-types
