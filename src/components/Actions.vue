<script setup lang="ts">
// TODO: (refactor) rethink how action data is organized
// TODO: (feature) get action modifiers on the card (somehow?)
import type { Ref } from 'vue'
import type { Actor, Item } from '@/types/pf2e-types'
const props = defineProps(['actor'])
import { inject, ref, computed } from 'vue'
import {
  capitalize,
  removeUUIDs,
  printPrice,
  SignedNumber,
  makeActionIcons
} from '@/utils/utilities'
import { useApi } from '@/composables/api'
import { useKeys } from '@/composables/injectKeys'

import InfoModal from '@/components/InfoModal.vue'
import SkillSelector from './SkillSelector.vue'

const infoModal = ref()
const skillSelector = ref()

const actor = inject(useKeys().actorKey)!
const action: Ref<Item | undefined> = computed(
  () => actor.value?.items?.find((i: Item) => i._id === infoModal?.value?.itemId)
)
const { characterAction } = useApi()
function doAction(slug: string) {
  characterAction(
    actor as Ref<Actor>,
    actionDefs.value.get(slug)?.alias ?? slug,
    actionDefs.value.get(slug)?.options
  ).then((r) => {
    infoModal.value.rollResultModal.open(r)
    infoModal.value.close()
  })
}

interface actionOptions {
  statistic: string
}
interface actionDef {
  alias?: string
  skill: string | null
  options?: actionOptions
}

const actionDefs = computed(() => {
  return new Map<string, actionDef>([
    ['administer-first-aid', { skill: 'medicine' }],
    [
      'aid',
      {
        skill: '*',
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
    <div class="[&:not(:has(li))]:hidden">
      <h3 class="text-lg underline">Actions</h3>
      <ul>
        <li
          v-for="feat in actor.items
            ?.filter((i: Item) => i.system.actionType?.value === 'action')
            .filter(
              (i: Item) =>
                !i.system.traits.value.includes('skill') && !actionDefs.get(i.system.slug)?.skill
            )"
        >
          <a class="cursor-pointer" @click="infoModal.open(feat._id)">
            {{ feat.name }}
            <span
              class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
              v-html="makeActionIcons(feat?.system?.actions.value + '')"
            ></span>
          </a>
        </li>
      </ul>
    </div>
    <div class="[&:not(:has(li))]:hidden">
      <h3 class="pt-2 text-lg underline">Reactions</h3>
      <ul>
        <li
          v-for="feat in actor.items?.filter(
            (i: Item) => i.system.actionType?.value === 'reaction'
          )"
        >
          <a class="cursor-pointer" @click="infoModal.open(feat._id)">
            {{ feat.name }}
            <span
              class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
              v-html="makeActionIcons('r')"
            ></span>
          </a>
        </li>
      </ul>
    </div>
    <div class="[&:not(:has(li))]:hidden">
      <h3 class="pt-2 text-lg underline">Free Actions</h3>
      <ul>
        <li v-for="feat in actor.items?.filter((i: Item) => i.system.actionType?.value === 'free')">
          <a class="cursor-pointer" @click="infoModal.open(feat._id)">
            {{ feat.name }}
            <span
              class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
              v-html="makeActionIcons(feat?.system?.actions.value + '')"
            ></span>
          </a>
        </li>
      </ul>
    </div>
    <div class="[&:not(:has(li))]:hidden">
      <h3 class="pt-2 text-lg underline">Skill Actions</h3>
      <ul>
        <li
          v-for="feat in actor?.items
            ?.filter((i: Item) => i.system.actionType?.value === 'action')
            .filter(
              (i: Item) =>
                i.system.traits.value.includes('skill') || actionDefs.get(i.system.slug)?.skill
            )"
        >
          <a class="cursor-pointer" @click="infoModal.open(feat._id)">
            {{ feat.name }}
            <span
              class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
              v-html="makeActionIcons(feat?.system?.actions.value + '')"
            ></span>
          </a>
        </li>
      </ul>
    </div>
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
        <div class="align-items-center flex gap-2">
          <SkillSelector
            v-if="actionDefs.get(action?.system.slug ?? '')?.skill === '*'"
            ref="skillSelector"
          />
          <button
            v-if="actor && actionDefs.get(action?.system.slug ?? '')"
            type="button"
            class="inline-flex items-end justify-center border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus:outline-none"
            @click="doAction(action!.system.slug)"
          >
            Roll
          </button>
        </div>
      </template>
    </InfoModal>
  </Teleport>
</template>
@/composables/api@/composables@/types/pf2e-types
