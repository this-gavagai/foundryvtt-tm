<script setup lang="ts">
import type { Item, FeatCategory, Actor } from '@/utils/pf2e-types'
import { inject } from 'vue'
import { makeTraits, capitalize, removeUUIDs, printPrice } from '@/utils/utilities'

const { actor } = defineProps<{ actor: Actor }>()
const infoModal: any = inject('infoModal')

function infoEquip(item: Item) {
  console.log(item)
  infoModal.value?.open({
    title: item.name,
    description: `Level ${item.system.level.value} <span class="text-sm">(${capitalize(
      item.system.traits.rarity
    )}, ${printPrice(item.system.price.value)})</span>`,
    body: makeTraits(item.system.traits.value) + removeUUIDs(item.system.description.value),
    iconPath: item.img
  })
}

// const categoryLabels = new Map([
//   ['PF2E.FeaturesAncestryHeader', 'Ancestry Features'],
//   ['PF2E.FeaturesClassHeader', 'Class Features'],
//   ['PF2E.FeatAncestryHeader', 'Ancestry Feats'],
//   ['PF2E.FeatClassHeader', 'Class Feats'],
//   ['PF2E.FeatArchetypeHeader', 'Archetype Feats'],
//   ['PF2E.FeatSkillHeader', 'Skill Feats'],
//   ['PF2E.FeatGeneralHeader', 'General Feats'],
//   ['PF2E.FeatBonusHeader', 'Bonus Feats']
// ])
const managedItemTypes = [
  'ancestry',
  'spell',
  'spellcastingEntry',
  'feat',
  'effect',
  'condition',
  'lore',
  'background',
  'class',
  'heritage',
  'action'
]
const inventoryTypes = [
  { type: 'weapon', title: 'Weapons' },
  { type: 'armor', title: 'Armor' },
  { type: 'equipment', title: 'Equipment' },
  { type: 'consumable', title: 'Consumables' },
  { type: 'treasure', title: 'Treasure' },
  { type: 'backpack', title: 'Containers' }
]
</script>
<template>
  <div class="px-6 py-4">
    <h3 class="underline text-2xl">Equipment</h3>
    <dl v-for="inventoryType in inventoryTypes" class="pt-4 whitespace-nowrap">
      <dt class="underline text-lg only:hidden">{{ inventoryType.title }}</dt>
      <dd
        v-for="item in actor.items.filter(
          (i: Item) => i.type === inventoryType.type && !i.system?.containerId
        )"
        @click="infoEquip(item)"
      >
        <div>
          <span class="pr-1">{{
            item.system?.equipped?.handsHeld > 0
              ? item.system?.equipped?.handsHeld === 1
                ? '❶'
                : '❷'
              : item.system?.equipped?.carryType === 'dropped'
              ? '⌵'
              : 'Ⓦ'
          }}</span>

          <span>{{ item.name }}</span>
          <span class="text-xs"> x{{ item.system.quantity }}</span>
        </div>
        <ul class="ml-8" v-if="item.type === 'backpack'">
          <li v-for="stowed in actor.items.filter((i: Item) => i.system?.containerId === item._id)">
            {{ stowed.name }}<span class="text-xs"> x{{ stowed.system.quantity }}</span>
          </li>
        </ul>
      </dd>
    </dl>
  </div>
</template>
