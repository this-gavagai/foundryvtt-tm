<script setup lang="ts">
// TODO (feature): handle versatile damage types
// TODO (refactor): use button widget
// TODO (data): add reload action from pf2e-ranged?
// TODO (data): show range of weapons
// TODO (bug): damage doesn't load if the button is clicked really quickly after reload. Why?

import { inject, ref, computed, watch } from 'vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import InfoModal from './InfoModal.vue'
import Button from '@/components/ButtonWidget.vue'
import ActionIcons from './ActionIcons.vue'

interface Trait {
  label: string | undefined
}

const strikeModal = ref()

const character = inject(useKeys().characterKey)!
const { strikes } = character

const viewedItem = computed(() => strikes.value?.[strikeModal.value?.itemId])
const strikeModalDamage = ref()
watch(viewedItem, async () => {
  strikeModalDamage.value = await viewedItem?.value?.getDamage?.()
})
</script>
<template>
  <div class="px-6 [&:not(:has(li))]:hidden">
    <h3 class="pt-2 text-lg underline">Strikes</h3>
    <ul>
      <li
        v-for="(strike, i) in strikes?.filter(
          (s) => s?.item?.system?.equipped?.carryType === 'held' || s?.item === undefined
        )"
        class="cursor-pointer pb-2"
        :key="strike.slug"
      >
        <div>{{ strike?.item?.name ?? strike?.label }}</div>
        <div class="flex flex-wrap leading-9">
          <span>
            <span
              v-for="(variant, index) in strike.variants"
              class="mb-1 mr-1 inline-block select-none border p-2 text-xs text-white transition-colors"
              :class="['bg-blue-600 hover:bg-blue-500 active:bg-blue-400']"
              @click="strikeModal.open(i, { type: 'strike', subtype: index })"
              :key="'variant_' + index"
            >
              <span v-if="!index">
                <ActionIcons actions="1" class="absolute mt-[-1px] h-0 text-lg leading-none" />
                <span class="pl-4">Strike&nbsp;</span>
              </span>
              <span>{{ index ? variant.label?.match(/\((.*)\)/)?.pop() : variant.label }}</span>
            </span>
          </span>
          <span>
            <span
              v-for="(variant, index) in [{ label: 'Damage' }, { label: 'Critical' }]"
              class="mb-1 mr-1 inline-block select-none border p-2 text-xs text-white transition-colors"
              :class="['bg-red-600 hover:bg-red-500 active:bg-red-400']"
              @click="strikeModal.open(i, { type: 'damage', subtype: index })"
              :key="'damage_' + index"
            >
              <span>{{ variant.label }}</span>
            </span>
          </span>
        </div>
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="strikeModal"
      :traits="
        viewedItem?.traits
          ?.map((t: Trait) => t.label)
          ?.concat(viewedItem?.weaponTraits?.map((t: Trait) => t.label) ?? [])
      "
      :imageUrl="viewedItem?.item?.img ?? 'icons/skills/melee/unarmed-punch-fist.webp'"
    >
      <template #title>{{ viewedItem?.label }}</template>
      <template #description>{{
        strikeModal.options?.type === 'damage' && strikeModal?.options?.subtype === 1
          ? strikeModalDamage?.response?.critical
          : strikeModalDamage?.response?.damage
      }}</template>
      <template #default>
        <ul>
          <li
            v-for="mod in strikeModal.options?.type === 'damage'
              ? strikeModalDamage?.response?.modifiers
              : viewedItem?._modifiers"
            class="flex gap-2"
            :class="{ 'text-gray-300': !mod.enabled }"
            :key="mod.slug"
          >
            <div class="w-8 text-right">
              {{ formatModifier(mod.modifier) }}
            </div>
            <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
          </li>
        </ul>
      </template>
      <template #actionButtons>
        <Button
          v-if="strikeModal.options?.type === 'strike'"
          type="button"
          color="blue"
          @click="
            viewedItem?.doStrike?.(strikeModal.options.subtype)?.then((r) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
          "
        >
          <span v-if="!strikeModal.options.subtype">Strike&nbsp;</span>
          <span>{{ viewedItem?.variants?.[strikeModal.options.subtype].label }}</span>
        </Button>

        <Button
          v-if="strikeModal.options?.type === 'damage' && strikeModal.options.subtype === 0"
          type="button"
          label="Damage"
          color="red"
          @click="
            viewedItem?.doDamage?.(strikeModal.options.subtype)?.then((r) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
          "
        />
        <Button
          v-if="strikeModal.options?.type === 'damage' && strikeModal.options.subtype === 1"
          type="button"
          label="Critical"
          color="red"
          @click="
            viewedItem?.doDamage?.(strikeModal.options.subtype)?.then((r) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
          "
        />
      </template>
    </InfoModal>
  </Teleport>
</template>
