<script setup lang="ts">
import type { Item } from '@/utils/pf2e-types'

import { ref, watch, provide, inject } from 'vue'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { useServer } from '@/utils/server'
import { mergeDeep } from '@/utils/utilities'

import InfoModal from '@/components/InfoModal.vue'
import RollModal from '@/components/RollModal.vue'
import CharacterHeader from '@/components/CharacterHeader.vue'
import Skills from '@/components/Skills.vue'
import Actions from '@/components/Actions.vue'
import Attributes from '@/components/Attributes.vue'
import Spells from '@/components/Spells.vue'
import Effects from '@/components/Effects.vue'
import Resources from '@/components/Resources.vue'
import Feats from '@/components/Feats.vue'
import Equipment from '@/components/Equipment.vue'
import Strikes from '@/components/Strikes.vue'
import Initiative from '@/components/Initiative.vue'

const props = defineProps(['characterId'])
const { socket } = useServer()

// await new socket
await new Promise(function (resolve: any) {
  ;(function waitForSocket() {
    if (socket.value) return resolve()
    console.log('waiting on socket...')
    setTimeout(waitForSocket, 1000)
  })()
})
if (socket.value == null) throw new Error('Socket Connection not available')

// make all provided data
const infoModal = ref()
provide('infoModal', infoModal)
const rollModal = ref()
provide('rollModal', rollModal)
const actor = ref<any>({})
provide('actor', actor)
const world: any = inject('world')

watch(world, () => {
  console.log(props.characterId)
})

socket.value.emit('module.tablemate', {
  action: 'requestCharacterDetails',
  characterId: props.characterId
})

socket.value.on('module.tablemate', (args: any) => {
  switch (args.action) {
    case 'gmOnline':
      socket.value.emit('module.tablemate', {
        action: 'requestCharacterDetails',
        characterId: props.characterId
      })
      break
    case 'sendCharacterDetails':
      if (args.actorId === props.characterId) {
        actor.value = args.actor
        mergeDeep(actor.value.system, args.system)
        actor.value.feats = args.feats
        actor.value.inventory = args.inventory
      }
      break
    case 'rollReady':
      if (args.characterId === props.characterId) {
        rollModal.value?.openModal(args.application, args.userId)
      }
      break
    default:
      console.log('roll not managed locally: ', args.action)
  }
})
socket.value.on('modifyDocument', (mods: any) => {
  // this should filter for active actor for all things, not just actor changes (also items)
  switch (mods.request.type) {
    case 'Actor':
      mods.result.forEach((change: any) => {
        if (change._id === actor.value._id) {
          mergeDeep(actor.value, change)
        }
      })
      break
    case 'Item':
      // handle item types
      switch (mods.request.action) {
        case 'update':
          mods.result.forEach((change: any) => {
            let inventoryItem = actor.value.items.find((a: any) => a._id == change._id)
            if (inventoryItem) mergeDeep(inventoryItem, change)
          })
          break
        case 'create':
          console.log(mods)
          if (mods.request.parentUuid === 'Actor.' + props.characterId) {
            mods.result.forEach((c: any) => {
              actor.value.items.push(c)
            })
          }
          break
        case 'delete':
          mods.result.forEach((d: string) => {
            const item = actor.value.items.find((i: any) => i._id === d)
            if (item) {
              const index = actor.value.items.indexOf(item)
              actor.value.items.splice(index, 1)
            }
          })
          break
        default:
          console.log('item action not handled', mods.request.action)
      }
      break
    default:
      console.log('request type not handled', mods.request.action)
  }
})

function updateActor() {
  console.log(props.characterId)
}

defineExpose({ updateActor })
</script>
<template>
  <div class="pb-14">
    <div class="p-0">
      <CharacterHeader :actor="actor" />
      <TabGroup>
        <TabPanels class="mb-16">
          <TabPanel>
            <Resources :actor="actor" />
            <Effects :actor="actor" />
            <Attributes class="px-6 py-4 flex justify-between border-b" :actor="actor"></Attributes>
            <Initiative class="px-6 py-4 border-b" :actor="actor" />
          </TabPanel>
          <TabPanel>
            <Feats :actor="actor" />
          </TabPanel>
          <TabPanel>
            <Equipment :actor="actor" />
          </TabPanel>
          <TabPanel>
            <Strikes :actor="actor" />
            <Actions :actor="actor" />
            <Skills :actor="actor" />
          </TabPanel>
          <TabPanel>
            <Spells class="px-6 py-4" :actor="actor" />
          </TabPanel>
          <TabPanel>
            <div class="px-6 py-4">Hi</div>
          </TabPanel>
        </TabPanels>
        <TabList
          class="fixed bottom-0 grid grid-cols-6 w-full bg-white gap-0 border border-gray-300 text-xs"
        >
          <Tab
            class="p-2 ui-selected:bg-blue-200 ui-not-selected:bg-white focus:outline-none relative top-0"
            ><img src="@/assets/icons/cowled.svg" class="m-auto max-h-14" />
            <span class="text-[.5rem]">Character</span></Tab
          >
          <Tab
            class="p-2 ui-selected:bg-blue-200 ui-not-selected:bg-white focus:outline-none relative top-0"
            ><img src="@/assets/icons/biceps.svg" class="m-auto max-h-14" />
            <span class="text-[.5rem]">Feats</span></Tab
          >
          <Tab
            class="p-2 ui-selected:bg-blue-200 ui-not-selected:bg-white focus:outline-none relative top-0"
            ><img src="@/assets/icons/backpack.svg" class="m-auto max-h-14" />
            <span class="text-[.5rem]">Gear</span></Tab
          >
          <Tab
            class="p-2 ui-selected:bg-blue-200 ui-not-selected:bg-white focus:outline-none relative top-0"
            ><img src="@/assets/icons/leapfrog.svg" class="m-auto max-h-14" />
            <span class="text-[.5rem]">Actions</span></Tab
          >
          <Tab
            class="p-2 ui-selected:bg-blue-200 ui-not-selected:bg-white focus:outline-none relative top-0"
            ><img src="@/assets/icons/spell-book.svg" class="m-auto max-h-16" />
            <span class="text-[.5rem]">Spells</span></Tab
          >
          <Tab
            class="p-2 ui-selected:bg-blue-200 ui-not-selected:bg-white focus:outline-none relative top-0"
            ><img src="@/assets/icons/talk.svg" class="m-auto max-h-16" />
            <span class="text-[.5rem]">Chat</span></Tab
          >
        </TabList>
      </TabGroup>
    </div>
    <InfoModal ref="infoModal" />
    <RollModal ref="rollModal" />
  </div>
</template>

<style scoped></style>
