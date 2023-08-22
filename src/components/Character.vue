<script setup lang="ts">
// todo: effects, equipment, attacks, actions
import type { Item } from '@/utils/pf2e-types'

import { storeToRefs } from 'pinia'
import { useSheet } from '@/stores/sheet'
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from '@headlessui/vue'

import { authenticateFoundry, connectToFoundry, type FoundrySocket } from '@/utils/foundry-api'
import { mergeDeep } from '@/utils/utilities'

import Counter from '@/components/Counter.vue'
import InfoModal from '@/components/InfoModal.vue'
import Attributes from '@/components/Attributes.vue'
import Statistic from '@/components/Statistic.vue'
import Consumables from '@/components/Consumables.vue'
import Spells from '@/components/Spells.vue'
import Effects from '@/components/Effects.vue'

const foundryUrl = new URL('http://192.168.2.148:30000/')
const foundryUsername = 'Gamemaster'
const foundryPassword = 'goshane'

const sheet = useSheet()
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

function infoPortrait() {
  infoModal.value.open({
    title: 'Quill',
    description: 'Handsome Young Man',
    body: '<p>The Quill is a rare species.</p><p>He have friend.</p>'
  })
}
function infoEffect(id: string) {}

function action(name: string, params: {}) {
  console.log('emitted', params)
}

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
      <div class="flex border p-4 items-center">
        <img
          class="h-24"
          :src="foundryUrl + actor.prototypeToken.texture?.src"
          @click="infoPortrait()"
        />
        <div class="pl-2">
          <h3 class="text-2xl">{{ actor.name }}</h3>
          <div class="text-md">
            {{ actor.items?.find((x: any) => x.type === 'ancestry').name }}
            {{ actor.items?.find((x: any) => x.type === 'background').name }}
          </div>
          <div class="text-md">
            {{ actor.items?.find((x: any) => x.type === 'class').name }}
            (Level {{ actor.system.details.level.value }})
          </div>
        </div>
      </div>
      <div class="border border-t-0 px-6 py-4 flex gap-2">
        <div
          v-for="effect in actor.items.filter((i: Item) =>
            ['effect', 'condition'].includes(i.type)
          )"
          @click="console.log(effect)"
        >
          <div class="w-12">
            <div class="relative">
              <div
                v-if="effect.system?.value?.value"
                class="absolute right-0 bottom-0 bg-[#FFFFFFCC] border border-black px-1 text-xs"
              >
                {{ effect.system?.value?.value }}
              </div>
              <img :src="foundryUrl + effect.img" class="h-12 w-12 rounded-full" />
            </div>
            <div class="text-[0.5rem] whitespace-nowrap overflow-hidden w-12 text-center">
              {{ effect.name.replace('Effect: ', '') }}
            </div>
          </div>
        </div>
      </div>
      <TabGroup>
        <TabPanels class="mb-16">
          <TabPanel>
            <div class="border border-t-0 px-6 py-4 flex gap-8">
              <Statistic heading="Hitpoints">
                {{ actor.system.attributes.hp.value }} / {{ actor.system.attributes.hp.max }}
              </Statistic>
              <Statistic heading="Hero Pts">
                <Counter
                  :value="actor.system.resources.heroPoints.value"
                  :max="actor.system.resources.heroPoints.max"
                />
              </Statistic>
              <Statistic heading="Experience">
                <div class="py-1">
                  <svg width="60" height="14">
                    <rect
                      :width="60 * (actor.system.details.xp.value / actor.system.details.xp.max)"
                      height="14"
                      style="fill: #ccc"
                    />
                    <rect
                      width="60"
                      height="14"
                      style="fill: transparent; stroke-width: 3; stroke: rgb(0, 0, 0)"
                    />
                    <text y="10" x="21" stroke="black" font-size="7pt" font-weight="lighter">
                      {{ actor.system.details.xp.value }}
                    </text>
                  </svg>
                </div>
              </Statistic>
            </div>
            <Attributes class="px-6 py-4 flex justify-between border-b"></Attributes>
            <div class="px-6 py-4 border-b">
              <ul class="max-w-6xl">
                <li v-for="skill in actor.system.skills" class="grid grid-cols-[3fr_2fr_1fr] gap-4">
                  <div>{{ skill.label }}</div>
                  <!-- <div>{{ ['U', 'T', 'E', 'M', 'L'][skill.rank] }}</div> -->
                  <div>{{ skill.modifiers.find((s: any) => s.type === 'proficiency').label }}</div>
                  <div class="text-right">{{ '+' + skill.totalModifier }}</div>
                </li>
              </ul>
            </div>
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
          <Tab class="p-2 px-4 ui-selected:bg-gray-200 focus:outline-none"
            ><img src="@/assets/icons/cowled.svg" class="h-8 w-8 m-auto" /><span
              class="text-[.5rem]"
              >Character</span
            ></Tab
          >
          <Tab class="p-2 px-4 ui-selected:bg-gray-200 focus:outline-none"
            ><img src="@/assets/icons/potion-ball.svg" class="h-8 w-8 m-auto" />
            <span class="text-[.5rem]">Items</span></Tab
          >
          <Tab class="p-2 px-4 ui-selected:bg-gray-200 focus:outline-none"
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
