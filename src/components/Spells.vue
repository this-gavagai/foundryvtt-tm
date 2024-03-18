<script setup lang="ts">
// TODO: deal with flexible prepared casters
// todo: wands
// TODO: (bug?) spell DC tends to pull from actor.system.attributes?.classOrSpellDC since the spellcastingEntry dc is rarely (never?) defined. is this okay?
// TODO: do something better with optionsblock type. We can do better.

import type { Item, Actor } from '@/utils/pf2e-types'
import { inject, computed, ref } from 'vue'
import { castSpell, updateActor, updateActorItem } from '@/utils/api'
import { capitalize, makeActionIcons, makePropertiesHtml, removeUUIDs } from '@/utils/utilities'

import Counter from '@/components/Counter.vue'
import Modal from '@/components/Modal.vue'
import InfoModal from '@/components/InfoModal.vue'

interface Spellbook {
  [key: string]: { [key: string]: [Item?] }
}
interface OptionsBlock {
  [key: string]: any
  // type: string
  // entry?: string
  // rank?: number
  // slot?: number
}

const infoModal = ref()
const spellSelectionModal = ref()

const actor: Actor = inject('actor')!
const viewedSpell = computed(
  () => actor.value.items?.find((i: any) => i._id === infoModal?.value?.itemId)
)

function updateSpellCharges(newTotal: number, options: OptionsBlock) {
  console.log(newTotal, options)
  switch (options.type) {
    case 'focus':
      updateActor(actor, { system: { resources: { focus: { value: newTotal } } } })
      break
    case 'charge':
      updateActorItem(
        actor,
        options.entry,
        {
          flags: { 'pf2e-dailies': { staff: { charges: newTotal } } }
        },
        {}
      )
      break
    case 'spontaneous':
      updateActorItem(
        actor,
        options.entry,
        {
          system: { slots: { ['slot' + options.rank]: { value: newTotal } } }
        },
        {}
      )
      break
    case 'prepared':
      const location = actor.value.items.find((i) => i._id === options.entry)
      const prepped = location!.system.slots['slot' + options.rank].prepared
      prepped[options.slot].expended = newTotal === 0 ? true : false
      updateActorItem(
        actor,
        options.entry,
        {
          system: { slots: { ['slot' + options.rank]: { prepared: prepped } } }
        },
        {}
      )
  }
}

function setSpell(
  location: Item | undefined,
  rank: number,
  slot: number,
  newSpellId: string | null
) {
  const prepared = location!.system.slots['slot' + rank]?.prepared
  if (!prepared[slot]) prepared[slot] = { id: null, expended: true }
  prepared[slot].id = newSpellId
  updateActorItem(
    actor,
    location!._id,
    {
      system: { slots: { ['slot' + rank]: { prepared: prepared } } }
    },
    {}
  )
}

const spellbook = computed((): Spellbook => {
  let sb: Spellbook = {} // {location - rank - spell}
  // set spellcastingEntry locations with empty ranks template
  actor.value.items
    ?.filter((i: Item) => i?.type === 'spellcastingEntry')
    .forEach((se: { _id: string }) => {
      const location = se._id
      // prettier-ignore
      sb[location] = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': [] }
    })

  // assign spells to spellbook ranks
  for (const locationId of Object.keys(sb)) {
    const location = actor.value.items.find((i: Item) => i._id === locationId)
    if (location?.system.prepared.value === 'prepared') {
      Object.values(location.system.slots).forEach((slot: any, slotRank: number) => {
        const preparedSpells = slot.prepared.map((slotSpell: any) =>
          actor.value.items.find((i: Item) => i._id === slotSpell.id)
        )
        const spellSlots = Object.assign(new Array(slot.max), preparedSpells.slice(0, slot.max))
        sb[locationId][slotRank] = spellSlots
      })
    } else {
      const spellsForLocation = actor.value.items.filter(
        (i: Item) => i.type === 'spell' && i.system.location.value === locationId
      )
      spellsForLocation?.forEach((s: Item) => {
        const rank = s.system.traits.value.includes('cantrip') ? '0' : String(s.system.level.value)
        sb[locationId][rank].push(s)
        // add signature spells by iterating through spellslots property
        if (s.system.location.signature) {
          Object.values(location?.system.slots).forEach((slot: any, slotRank: number) => {
            if (slot.max && slotRank > s.system.level.value) {
              sb[locationId][slotRank].push(s)
            }
          })
        }
      })
      // put signature spells at the end
      Object.entries(sb[locationId]).forEach((rank: any) => {
        rank[1]
          .sort((a: any, b: any) => a.system.level.value - b.system.level.value)
          .sort(
            (a: any, b: any) =>
              (a.system.level.value == rank[0] ? 0 : 1) - (b.system.level.value == rank[0] ? 0 : 1)
          )
      })
    }
  }
  return sb
})
</script>
<template>
  <div class="px-6 py-4">
    <ul class="">
      <li
        v-for="location in actor.items?.filter((x: Item) => x?.type === 'spellcastingEntry')"
        class="mt-4 first:mt-0"
      >
        <h3 class="flex justify-between align-bottom bg-gray-300">
          <span class="underline text-xl">
            {{ location.name }}
          </span>
          <span class="pl-1">
            <Counter
              v-if="location.system?.prepared.value === 'focus'"
              class="relative bottom-[-2px] text-sm mr-2"
              :value="actor.system.resources.focus.value"
              :max="actor.system.resources.focus.max"
              title="Focus Pool"
              editable
              @change-count="(newTotal) => updateSpellCharges(newTotal, { type: 'focus' })"
            />
            <Counter
              v-if="location.system?.prepared.value === 'charge'"
              class="relative bottom-[-2px] text-sm mr-2"
              :value="location.flags?.['pf2e-dailies']?.staff?.charges"
              :title="location.name"
              editable
              @change-count="
                (newTotal) => updateSpellCharges(newTotal, { type: 'charge', entry: location._id })
              "
            />
          </span>
        </h3>
        <div>
          Spell DC
          {{ location.system.spelldc.dc || actor.system.attributes?.classOrSpellDC?.value }}
        </div>
        <!-- Spell Ranks -->
        <ul>
          <li
            v-for="(spells, rank) in spellbook[location._id]"
            class="mt-2 first:mt-0"
            :class="{ hidden: !spells.length }"
          >
            <h4 class="text-sm italic flex justify-between align-bottom bg-gray-200">
              <span class="pr-1">
                {{ rank == '0' ? 'Cantrips' : 'Rank ' + rank }}
              </span>
              <Counter
                class="relative bottom-[-1px] text-sm mr-2"
                v-if="location.system?.prepared.value === 'spontaneous'"
                :value="location.system.slots['slot' + rank].value"
                :max="location.system.slots['slot' + rank].max"
                editable
                :title="`Rank ${rank}`"
                @change-count="
                  (newTotal) =>
                    updateSpellCharges(newTotal, {
                      type: 'spontaneous',
                      entry: location._id,
                      rank: rank
                    })
                "
              />
            </h4>
            <!-- Spells -->
            <ul class="empty:hidden">
              <li v-for="(spell, index) in spells" class="flex justify-between">
                <div
                  class="text-md"
                  :class="{
                    'bg-blue-50':
                      spell?.system?.location?.signature &&
                      spell?.system?.level.value !== Number(rank)
                  }"
                >
                  <span
                    v-if="spell"
                    @click="
                      infoModal.open(spell?._id, {
                        entry: location._id,
                        castingRank: Number(rank),
                        castingSlot: index
                      })
                    "
                    class="cursor-pointer"
                  >
                    <span>{{ spell?.name }}</span>
                    <span class="pl-1 text-md pf2-icon">{{
                      spell?.system?.time.value.replace('to', ' - ').replace('free', 'f')
                    }}</span>
                  </span>
                  <span
                    v-else
                    @click="
                      spellSelectionModal.open({
                        entry: location._id,
                        castingRank: Number(rank),
                        castingSlot: index
                      })
                    "
                    class="cursor-pointer"
                    >(empty)</span
                  >
                </div>
                <Counter
                  class="relative bottom-[-1px] text-sm mr-2"
                  v-if="location.system?.prepared.value === 'prepared'"
                  :value="
                    location.system.slots['slot' + rank].prepared[index]?.expended === false ? 1 : 0
                  "
                  :max="1"
                  editable
                  :title="`Rank ${rank}: ${spell?.name}`"
                  @change-count="
                    (newTotal) =>
                      updateSpellCharges(newTotal, {
                        type: 'prepared',
                        entry: location._id,
                        rank,
                        slot: index
                      })
                  "
                />
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="viewedSpell?.img"
      :traits="viewedSpell?.system?.traits.value"
    >
      <template #title>
        {{ viewedSpell?.name }}
        <span
          class="text-2xl relative pl-1 -mt-[.3rem]"
          v-html="
            makeActionIcons(
              viewedSpell?.system?.time.value.replace('to', ' - ').replace('free', 'f')
            )
          "
        ></span>
      </template>
      <template #description>
        {{
          viewedSpell?.system.traits.value.includes('cantrip')
            ? `Cantrip`
            : `Rank ${viewedSpell?.system.level.value}`
        }}
        <span class="text-sm">{{ capitalize(viewedSpell?.system.traits.rarity) }}</span>
      </template>
      <template #body>
        <div v-html="makePropertiesHtml(viewedSpell)"></div>
        <div v-html="removeUUIDs(viewedSpell?.system.description.value)"></div>
      </template>
      <template #actionButtons>
        <button
          v-if="
            actor.items.find((i) => i._id === infoModal.options?.entry)?.system.prepared.value ===
            'prepared'
          "
          type="button"
          class="bg-red-200 hover:bg-red-300 inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
          @click="
            () => {
              setSpell(
                actor.items.find((i) => i._id === infoModal.options?.entry),
                infoModal.options.castingRank,
                infoModal.options.castingSlot,
                null
              )
              infoModal.close()
            }
          "
        >
          Remove
        </button>
        <button
          type="button"
          class="bg-blue-600 hover:bg-blue-500 text-white inline-flex justify-center items-end border border-transparent px-4 py-2 text-sm font-medium focus:outline-none"
          @click="
            () => {
              castSpell(
                actor,
                viewedSpell!._id,
                infoModal.options?.castingRank,
                infoModal.options?.castingSlot
              ).then((r) => console.log(r))
              infoModal.close()
            }
          "
        >
          Cast!
        </button>
      </template>
    </InfoModal>
    <Modal ref="spellSelectionModal" title="Select a spell">
      <ul>
        <li
          class="cursor-pointer"
          v-for="spell in actor.items.filter(
            (i) =>
              i.type === 'spell' &&
              i.system.location.value === spellSelectionModal.options?.entry &&
              i.system.level.value <= spellSelectionModal.options.castingRank
          )"
          @click="
            () => {
              setSpell(
                actor.items.find((i) => i._id === spellSelectionModal.options?.entry),
                spellSelectionModal.options.castingRank,
                spellSelectionModal.options.castingSlot,
                spell._id
              )
              spellSelectionModal.close()
            }
          "
        >
          {{ spell.name }}
        </li>
      </ul>
    </Modal>
  </Teleport>
</template>
