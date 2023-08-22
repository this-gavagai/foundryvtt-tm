<script setup lang="ts">
// todo: equipment, attacks, actions
import type { Item } from '@/utils/pf2e-types'

import { storeToRefs } from 'pinia'
import { useSheet } from '@/stores/sheet'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { authenticateFoundry, connectToFoundry, type FoundrySocket } from '@/utils/foundry-api'
import { mergeDeep } from '@/utils/utilities'

import CharacterHeader from '@/components/CharacterHeader.vue'
import Skills from '@/components/Skills.vue'
import InfoModal from '@/components/InfoModal.vue'
import Attributes from '@/components/Attributes.vue'
import Consumables from '@/components/Consumables.vue'
import Spells from '@/components/Spells.vue'
import Effects from '@/components/Effects.vue'
import Resources from '@/components/Resources.vue'

const foundryUrl = new URL('http://192.168.2.148:30000/')
const foundryUsername = 'Gamemaster'
const foundryPassword = 'goshane'

const sheet = await useSheet()
const { actor, socket, infoModal } = storeToRefs(sheet)

const sessionId = await authenticateFoundry(foundryUrl, foundryUsername, foundryPassword)
socket.value = await connectToFoundry(foundryUrl, sessionId, true)

const { characterId } = defineProps<{ characterId: string }>()

// const world: any = ref({})
// world.value = socket.emit('world')

socket.value.removeAllListeners('module.keybard')
socket.value.on('module.keybard', (args: any) => {
  if (args.action == 'sendCharacterDetails' && args.actorId === characterId) {
    actor.value = args.actor
    mergeDeep(actor.value.system, args.system)
  }
})
socket.value.emit('module.keybard', { action: 'requestCharacterDetails', characterId: characterId })

// wait until the actor is set, listening for changes in the value
await new Promise(function (resolve: any) {
  ;(function waitForActor() {
    if (Object.keys(actor.value).length) return resolve()
    setTimeout(waitForActor, 50)
  })()
})

socket.value.removeAllListeners('modifyDocument')
socket.value.on('modifyDocument', (mods: any) => {
  if (mods.request.type === 'Actor') {
    mods.result.forEach((change: any) => {
      if (change._id === actor.value._id) {
        mergeDeep(actor.value, change)
      }
    })
  } else if (mods.request.type === 'Item') {
    if (mods.request.action === 'update') {
      mods.result.forEach((change: any) => {
        let inventoryItem = actor.value.items.find((a: any) => a._id == change._id)
        mergeDeep(inventoryItem, change)
      })
    } else if (mods.request.action == 'create') {
      console.log('creation')
      mods.result.forEach((c: any) => {
        actor.value.items.push(c)
      })
    } else if (mods.request.action == 'delete') {
      console.log('deletion')
      mods.result.forEach((d: string) => {
        const item = actor.value.items.find((i: any) => i._id === d)
        const index = actor.value.items.indexOf(item)
        console.log('my index', index)
        actor.value.items.splice(index, 1)
      })
    }
  }
})

// DEBUGGING CONVENIENCES ///
declare global {
  interface Window {
    socket: any
    actor: any
    world: any
  }
}
window.socket = socket
window.actor = actor.value
// window.world = world.value

//socket.close()
</script>
<template>
  <div class="min-h-[100vh]">
    <div class="p-0">
      <CharacterHeader />
      <TabGroup>
        <TabPanels class="mb-16">
          <TabPanel>
            <Resources />
            <Effects />
            <Attributes class="px-6 py-4 flex justify-between border-b"></Attributes>
            <Skills />
          </TabPanel>
          <TabPanel>
            <Consumables class="px-6 py-4" />
          </TabPanel>
          <TabPanel>
            <Spells class="px-6 py-4" />
          </TabPanel>
        </TabPanels>
        <TabList
          class="fixed bottom-0 flex h-16 bg-white gap-1 border w-full border-gray-300 text-xs"
        >
          <Tab class="p-2 ui-selected:bg-gray-200 focus:outline-none"
            ><img src="@/assets/icons/cowled.svg" class="h-8 w-8 m-auto" /><span
              class="text-[.5rem]"
              >Character</span
            ></Tab
          >
          <Tab class="p-2 ui-selected:bg-gray-200 focus:outline-none"
            ><img src="@/assets/icons/potion-ball.svg" class="h-8 w-8 m-auto" />
            <span class="text-[.5rem]">Items</span></Tab
          >
          <Tab class="p-2 ui-selected:bg-gray-200 focus:outline-none"
            ><img src="@/assets/icons/spell-book.svg" class="h-8 w-8 m-auto" />
            <span class="text-[.5rem]">Spells</span></Tab
          >
        </TabList>
      </TabGroup>
    </div>
    <InfoModal ref="infoModal" />
  </div>
</template>

<style scoped></style>
