<script setup lang="ts">
// TODO (refactor): too much repetition between this and the strikes list
import { inject, ref, computed, watch } from 'vue'
import { formatModifier, capitalize } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import InfoModal from './InfoModal.vue'
import Button from '@/components/ButtonWidget.vue'
import ActionIcons from './ActionIcons.vue'

// interface Trait {
//   label: string | undefined
// }
const blastModal = ref()

const character = inject(useKeys().characterKey)!
const { blasts } = character

const viewedItem = computed(() => blasts?.value?.[blastModal.value?.itemId])
const blastModalDamage = ref()
watch(viewedItem, async () => {
  //TODO: figure out damage fetching for elemental blasts
  //   strikeModalDamage.value = await viewedItem?.value?.getDamage?.()
})
</script>
<template>
  <div class="px-6 [&:not(:has(li))]:hidden">
    <h3 class="pt-2 text-lg underline">Elemental Blasts</h3>
    <ul>
      <li v-for="(blast, i) in blasts" class="cursor-pointer pb-2" :key="blast.element">
        <div v-for="attackType in ['melee', 'ranged']" :key="'at_' + attackType">
          <div>
            Elemental Blast ({{ capitalize(blast.element) }}) - {{ capitalize(attackType) }}
          </div>
          <div class="flex flex-wrap leading-9">
            <span>
              <span
                v-for="(variant, index) in [
                  attackType === 'melee' ? blast?.maps?.melee?.map0 : blast?.maps?.ranged?.map0,
                  attackType === 'melee' ? blast?.maps?.melee?.map1 : blast?.maps?.ranged?.map1,
                  attackType === 'melee' ? blast?.maps?.melee?.map2 : blast?.maps?.ranged?.map2
                ]"
                class="mb-1 mr-1 inline-block select-none border p-2 text-xs text-white transition-colors"
                :class="['bg-blue-600 hover:bg-blue-500 active:bg-blue-400']"
                @click="blastModal.open(i, { type: 'blast', subtype: index, attackType })"
                :key="'variant_' + index"
              >
                <ActionIcons actions="1" v-if="!index" class="h-0 pr-2 pt-1 text-lg leading-none" />
                <span v-if="!index">Blast&nbsp;</span>
                <span>{{ index ? variant?.match(/\((.*)\)/)?.pop() : variant }}</span>
              </span>
            </span>
            <span>
              <span
                v-for="(variant, index) in [{ label: 'Damage' }, { label: 'Critical' }]"
                class="mb-1 mr-1 inline-block select-none border p-2 text-xs text-white transition-colors"
                :class="['bg-red-600 hover:bg-red-500 active:bg-red-400']"
                @click="blastModal.open(i, { type: 'blastDamage', subtype: index, attackType })"
                :key="'damage_' + index"
              >
                <span>{{ variant.label }}</span>
              </span>
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="blastModal"
      :traits="
        viewedItem?.item?.system?.traits?.value // TODO: add damage type to traits
      "
      :imageUrl="viewedItem?.img"
    >
      <template #title
        >Elemental Blast ({{ capitalize(viewedItem?.element) }}) -
        {{ capitalize(blastModal.options?.attackType) }}</template
      >
      <template #description>{{
        blastModal?.options?.type === 'damage' && blastModal?.options?.subtype === 1
          ? blastModalDamage?.response?.critical
          : blastModalDamage?.response?.damage
      }}</template>
      <template #default>
        <ul>
          <li
            v-for="mod in blastModal.options?.type === 'blastDamage'
              ? blastModalDamage?.response?.modifiers
              : viewedItem?.statistic?.modifiers"
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
          v-if="blastModal.options?.type === 'blast'"
          type="button"
          color="blue"
          @click="
            viewedItem
              ?.doBlast?.(
                viewedItem?.element ?? '',
                viewedItem.damageTypes[0].value ?? '', // TODO (feature): allow damage type to be selectable (see below)
                blastModal.options.subtype,
                blastModal?.options?.attackType === 'melee'
              )
              ?.then((r) => {
                blastModal.close()
                blastModal.rollResultModal.open(r)
              })
          "
        >
          <span v-if="!blastModal.options.subtype">Blast</span>
          <span>{{
            viewedItem?.maps?.[blastModal.options.attackType as keyof object]?.[
              'map' + blastModal.options.subtype
            ]
          }}</span>
        </Button>

        <Button
          v-if="blastModal.options?.type === 'blastDamage' && blastModal.options.subtype === 0"
          type="button"
          label="Damage"
          color="red"
          @click="
            viewedItem
              ?.doBlastDamage?.(
                viewedItem?.element ?? '',
                viewedItem.damageTypes[0].value ?? '', // TODO (feature): allow damage type to be selectable (see above)
                'success',
                blastModal?.options?.attackType === 'melee'
              )
              ?.then((r) => {
                blastModal.close()
                blastModal.rollResultModal.open(r)
              })
          "
        />
        <!-- TODO (refactor): refactor to combine two buttons into one structure -->
        <Button
          v-if="blastModal.options?.type === 'blastDamage' && blastModal.options.subtype === 1"
          type="button"
          label="Critical"
          color="red"
          @click="
            viewedItem
              ?.doBlastDamage?.(
                viewedItem?.element ?? '',
                viewedItem.damageTypes[0].value ?? '', // TODO (feature): allow damage type to be selectable (see above)
                'criticalSuccess',
                blastModal?.options?.attackType === 'melee'
              )
              ?.then((r) => {
                blastModal.close()
                blastModal.rollResultModal.open(r)
              })
          "
        />
      </template>
    </InfoModal>
  </Teleport>
</template>
