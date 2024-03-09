<script setup lang="ts">
import { ref, watch, provide, inject } from 'vue'
import { TabGroup, TabList, TabPanels, TabPanel } from '@headlessui/vue'

import { useServer } from '@/utils/server'
import { mergeDeep } from '@/utils/utilities'

import cowled from '@/assets/icons/cowled.svg'
import biceps from '@/assets/icons/biceps.svg'
import backpack from '@/assets/icons/backpack.svg'
import leapfrog from '@/assets/icons/leapfrog.svg'
import spellBook from '@/assets/icons/spell-book.svg'
import talk from '@/assets/icons/talk.svg'

import CharacterTab from '@/components/CharacterTab.vue'
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

// make all provided data
const world: any = inject('world')
const rollModal = ref()
provide('rollModal', rollModal)
const actor = ref<any>({})
provide('actor', actor)

// watch world for changes and update actor base
watch(
  world,
  () => {
    if (world.value?.actors) {
      const worldActor = world.value.actors.find((a: any) => a._id == props.characterId)
      const synthActor = mergeDeep(worldActor, actor.value)
      actor.value = synthActor
    }
  },
  { immediate: true }
)

// await new socket
const { socket } = useServer()
await new Promise(function (resolve: any) {
  ;(function waitForSocket() {
    if (socket.value) return resolve()
    console.log('waiting on socket...')
    setTimeout(waitForSocket, 100)
  })()
})

// send request for enhanced character data
socket.value.emit('module.tablemate', {
  action: 'requestCharacterDetails',
  actorId: props.characterId
})

// listen for tablemate messages
socket.value.on('module.tablemate', (args: any) => {
  switch (args.action) {
    case 'gmOnline':
      socket.value.emit('module.tablemate', {
        action: 'requestCharacterDetails',
        actorId: props.characterId
      })
      break
    case 'updateCharacterDetails':
      if (args.actorId === props.characterId) {
        actor.value = args.actor
        mergeDeep(actor.value.system, args.system)
        actor.value.feats = args.feats
        // actor.value.inventory = args.inventory
        if (!window.actor) window.actor = actor.value
      }
      break
    // case 'rollReady':
    //   if (args.characterId === props.characterId) {
    //     rollModal.value?.openModal(args.application, args.userId)
    //   }
    //   break
    default:
      console.log('roll not managed locally: ', args.action)
  }
})
// listen for modifyDocument messages
socket.value.on('modifyDocument', (mods: any) => {
  // TODO: This is super verbose and not efficient at all. Need to think of a better way to handle synthetic data
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

// debugging conveniences
declare global {
  interface Window {
    socket: any
    actor: any
    world: any
    altCharacters: any
  }
}
</script>
<template>
  <div class="pb-14">
    <div class="p-0">
      <CharacterHeader />
      <TabGroup>
        <TabPanels class="mb-16 focus:ring-color-red-100">
          <TabPanel class="mb-16 focus:ring-color-red-100">
            <Resources />
            <Effects />
            <Attributes />
            <Initiative />
          </TabPanel>
          <TabPanel>
            <Feats />
          </TabPanel>
          <TabPanel>
            <Equipment />
          </TabPanel>
          <TabPanel>
            <Strikes />
            <Actions />
            <Skills />
          </TabPanel>
          <TabPanel>
            <Spells />
          </TabPanel>
          <TabPanel>
            <div class="px-6 py-4">
              <div v-for="message in world.messages">
                <div v-html="message.flavor" class="border m-2 p-2"></div>
              </div>
            </div>
          </TabPanel>
        </TabPanels>
        <TabList class="fixed bottom-0 grid grid-cols-6 w-full gap-0 border border-gray-300">
          <CharacterTab :src="cowled" label="Character" />
          <CharacterTab :src="biceps" label="Feats" />
          <CharacterTab :src="backpack" label="Equipment" />
          <CharacterTab :src="leapfrog" label="Actions" />
          <CharacterTab :src="spellBook" label="Spells" />
          <CharacterTab :src="talk" label="Chat" />
        </TabList>
      </TabGroup>
    </div>
  </div>
</template>

<style scoped></style>
