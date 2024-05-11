<script setup lang="ts">
// TODO: (feature) deal with flexible prepared casters
// TODO: (feature+) figure out how to get staves in here (integration with pf2e-dailies?)

import type { Ref } from 'vue'
import type { Item, Actor } from '@/types/pf2e-types'
import { inject, computed, ref } from 'vue'
import { useApi } from '@/composables/api'
import { capitalize, makeActionIcons, makePropertiesHtml, removeUUIDs } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'

import Button from '@/components/Button.vue'
import Counter from '@/components/Counter.vue'
import Modal from '@/components/Modal.vue'
import InfoModal from '@/components/InfoModal.vue'
import type { NumberLiteralType } from 'typescript'

interface Spellbook {
  [key: string]: { [key: string]: [Item?] }
}
interface SlotInfo {
  value: number
  max: number
  prepared: PreparedSpellInfo[]
}
interface PreparedSpellInfo {
  id: string
}
interface SpellInfo {
  type?: 'focus' | 'charge' | 'spontaneous' | 'prepared' | 'wand'
  entry?: Item
  entryId?: string
  castingRank?: number
  castingSlot?: number
  isConsumable?: boolean
}
interface SpellChargeOptions {
  type: string
  entryId?: string
  rank?: number | string
  slot?: number
  itemId?: string
}

const actor = inject(useKeys().actorKey)!
const { updateActor, updateActorItem, castSpell, consumeItem } = useApi()

const infoModal = ref()
const spellSelectionModal = ref()
const castButton = ref()
const consumeButton = ref()
const removeButton = ref()

const viewedSpell = computed(
  () => actor.value?.items?.find((i: Item) => i._id === infoModal?.value?.itemId)
)

function doSpell(spellId: string, info: SpellInfo) {
  castButton.value.waiting = true
  if (actor.value)
    castSpell(actor as Ref<Actor>, spellId, info.castingRank!, info.castingSlot!).then((r) => {
      castButton.value.waiting = false
      infoModal.value.close()
    })
}
function doConsumable(itemId: string) {
  consumeButton.value.waiting = true
  if (actor.value)
    consumeItem(actor as Ref<Actor>, itemId).then((r) => {
      consumeButton.value.waiting = false
      infoModal.value.close()
    })
}
function setSpellAndClose(info: SpellInfo, newSpellId: string | null) {
  if (!actor.value) return
  removeButton.value.waiting = true
  const prepared = info.entry?.system.slots['slot' + info.castingRank]?.prepared
  if (!prepared[info.castingSlot ?? ''])
    prepared[info.castingSlot ?? ''] = { id: null, expended: true }
  prepared[info.castingSlot ?? ''].id = newSpellId

  updateActorItem(actor as Ref<Actor>, info.entry!._id, {
    system: { slots: { ['slot' + info.castingRank]: { prepared: prepared } } }
  }).then(() => {
    removeButton.value.waiting = false
    infoModal.value.close()
    spellSelectionModal.value.close()
  })
}
function updateSpellCharges(newTotal: number, options: SpellChargeOptions) {
  if (!actor.value) return
  switch (options.type) {
    case 'focus':
      updateActor(actor as Ref<Actor>, { system: { resources: { focus: { value: newTotal } } } })
      break
    case 'charge':
      updateActorItem(actor as Ref<Actor>, options.entryId!, {
        flags: { 'pf2e-dailies': { staff: { charges: newTotal } } }
      })
      break
    case 'spontaneous':
      updateActorItem(actor as Ref<Actor>, options.entryId!, {
        system: { slots: { ['slot' + options.rank]: { value: newTotal } } }
      })
      break
    case 'prepared':
      const location = actor.value.items.find((i) => i._id === options.entryId)
      const prepped = location!.system.slots['slot' + options.rank].prepared
      prepped[options.slot!].expended = newTotal === 0 ? true : false
      updateActorItem(actor as Ref<Actor>, options.entryId!, {
        system: { slots: { ['slot' + options.rank]: { prepared: prepped } } }
      })
      break
    case 'wand':
      updateActorItem(actor as Ref<Actor>, options.itemId!, {
        system: { uses: { value: newTotal } }
      })
      break
  }
}

const spellbook = computed((): Spellbook => {
  let sb: Spellbook = {} // {location - rank - spell}
  // set spellcastingEntry locations with empty ranks template
  actor.value?.items
    ?.filter((i: Item) => i?.type === 'spellcastingEntry')
    .forEach((se: { _id: string }) => {
      const location = se._id
      // prettier-ignore
      sb[location] = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': [] }
    })
  // assign spells to spellbook ranks
  for (const locationId of Object.keys(sb)) {
    const location = actor.value?.items.find((i: Item) => i._id === locationId)
    if (location?.system.prepared.value === 'prepared') {
      Object.values(location.system.slots as SlotInfo[]).forEach(
        (slot: SlotInfo, slotRank: number) => {
          const preparedSpells = slot.prepared.map(
            (slotSpell) => actor.value?.items.find((i: Item) => i._id === slotSpell.id)
          )
          const spellSlots = Object.assign(new Array(slot.max), preparedSpells.slice(0, slot.max))
          sb[locationId][slotRank] = spellSlots as [Item]
        }
      )
    } else {
      const spellsForLocation = actor.value?.items.filter(
        (i: Item) => i.type === 'spell' && i.system.location.value === locationId
      )
      spellsForLocation?.forEach((s: Item) => {
        const rank = s.system.traits.value.includes('cantrip') ? '0' : String(s.system.level.value)
        sb[locationId][rank].push(s)
        // add signature spells by iterating through spellslots property
        if (s.system.location.signature) {
          Object.values(location?.system.slots as SlotInfo[]).forEach(
            (slot: SlotInfo, slotRank: number) => {
              if (slot.max && slotRank > s.system.level.value) {
                sb[locationId][slotRank].push(s)
              }
            }
          )
        }
      })
      // put signature spells at the end
      const spellRanks = Object.entries(sb[locationId]) as [string, [(Item | undefined)?]][]
      spellRanks.forEach((rank: [string, [(Item | undefined)?]]) => {
        rank[1]
          .sort(
            (a: Item | undefined, b: Item | undefined) =>
              a?.system.level.value - b?.system.level.value
          )
          .sort(
            (a: Item | undefined, b: Item | undefined) =>
              (a?.system.level.value == rank[0] ? 0 : 1) -
              (b?.system.level.value == rank[0] ? 0 : 1)
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
        v-for="location in actor?.items?.filter((x: Item) => x?.type === 'spellcastingEntry')"
        class="mt-4 first:mt-0"
      >
        <h3 class="flex justify-between bg-gray-300 align-bottom">
          <span class="text-xl underline">
            {{ location.name }}
          </span>
          <span class="pl-1">
            <Counter
              v-if="location.system?.prepared.value === 'focus'"
              class="relative bottom-[-2px] mr-2 text-sm"
              :value="actor?.system.resources.focus.value"
              :max="actor?.system.resources.focus.max"
              title="Focus Pool"
              editable
              @change-count="(newTotal) => updateSpellCharges(newTotal, { type: 'focus' })"
            />
            <Counter
              v-if="location.system?.prepared.value === 'charge'"
              class="relative bottom-[-2px] mr-2 text-sm"
              :value="location.flags?.['pf2e-dailies']?.staff?.charges"
              :title="location.name"
              editable
              @change-count="
                (newTotal) =>
                  updateSpellCharges(newTotal, { type: 'charge', entryId: location._id })
              "
            />
          </span>
        </h3>
        <div v-if="location.system.spelldc.dc || actor?.system.attributes?.spellDC?.value">
          Spell DC
          {{ location.system.spelldc.dc || actor?.system.attributes?.spellDC?.value }}
        </div>
        <!-- Spell Ranks -->
        <ul>
          <li
            v-for="(spells, rank) in spellbook[location._id]"
            class="mt-2 first:mt-0"
            :class="{ hidden: !spells.length }"
          >
            <h4 class="flex justify-between bg-gray-200 align-bottom text-sm italic">
              <span class="pr-1">
                {{ rank == '0' ? 'Cantrips' : 'Rank ' + rank }}
              </span>
              <Counter
                class="relative bottom-[-1px] mr-2 text-sm"
                v-if="location.system?.prepared.value === 'spontaneous'"
                :value="location.system.slots['slot' + rank].value"
                :max="location.system.slots['slot' + rank].max"
                editable
                :title="`Rank ${rank}`"
                @change-count="
                  (newTotal) =>
                    updateSpellCharges(newTotal, {
                      type: 'spontaneous',
                      entryId: location._id,
                      rank: rank
                    })
                "
              />
            </h4>
            <!-- Spells -->
            <ul class="empty:hidden">
              <li v-for="(spell, index) in spells" class="flex justify-between">
                <div class="text-md">
                  <span
                    v-if="spell"
                    @click="
                      infoModal.open(spell?._id, {
                        entry: location,
                        entryId: location._id,
                        castingRank: Number(rank),
                        castingSlot: index
                      } as SpellInfo)
                    "
                    class="cursor-pointer"
                  >
                    <span
                      v-if="
                        spell?.system?.location?.signature &&
                        spell?.system?.level.value !== Number(rank)
                      "
                      >*</span
                    >
                    <span>{{ spell?.name }}</span>
                    <span class="text-md pf2-icon pl-1">{{
                      spell?.system?.time.value.replace('to', ' - ').replace('free', 'f')
                    }}</span>
                  </span>
                  <span
                    v-else
                    @click="
                      spellSelectionModal.open({
                        entry: location,
                        entryId: location._id,
                        castingRank: Number(rank),
                        castingSlot: index
                      } as SpellInfo)
                    "
                    class="cursor-pointer text-gray-500"
                    >(empty)</span
                  >
                </div>
                <Counter
                  class="relative bottom-[-1px] mr-2 text-sm"
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
                        entryId: location._id,
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
      <!-- Wands and Scrolls -->
      <li class="mt-4 first:mt-0 [&:not(:has(li))]:hidden">
        <h3 class="flex justify-between bg-gray-300 align-bottom">
          <span class="text-xl underline"> Wands and Scrolls </span>
        </h3>
        <div class="pb-1" v-if="actor?.system.attributes?.spellDC?.value">
          Spell DC
          {{ actor?.system.attributes?.spellDC?.value }}
        </div>
        <ul class="empty:hidden">
          <li
            v-for="spell in actor?.items
              .filter(
                (i) =>
                  i.system.traits.value?.includes('scroll') ||
                  i.system.traits.value?.includes('wand')
              )
              .sort(
                (a, b) => a.system.spell.system.level.value - b.system.spell.system.level.value
              )"
            class="flex justify-between"
          >
            <div>
              <span
                v-if="spell"
                @click="infoModal.open(spell?._id, { isConsumable: true } as SpellInfo)"
                class="cursor-pointer"
              >
                {{ spell.name }}
              </span>
            </div>
            <Counter
              class="relative bottom-[-1px] mr-2 text-sm"
              :value="spell.system.uses.value"
              :max="spell.system.uses.max"
              :title="spell.name"
              editable
              @change-count="
                (newTotal) => updateSpellCharges(newTotal, { type: 'wand', itemId: spell._id })
              "
            />
          </li>
        </ul>
      </li>
    </ul>
  </div>
  <Teleport to="#modals">
    <InfoModal
      ref="infoModal"
      :imageUrl="viewedSpell?.img"
      :traits="viewedSpell?.system?.traits?.value"
    >
      <template #title>
        {{ viewedSpell?.name }}
        <span
          class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
          v-html="
            makeActionIcons(
              viewedSpell?.system?.time?.value.replace('to', ' - ').replace('free', 'f') ?? ''
            )
          "
        ></span>
      </template>
      <template #description>
        {{
          viewedSpell?.system.traits?.value.includes('cantrip')
            ? `Cantrip`
            : `Rank ${viewedSpell?.system.level?.value}`
        }}
        <span class="text-sm">{{ capitalize(viewedSpell?.system.traits.rarity) }}</span>
      </template>
      <template #body>
        <div v-if="infoModal.options?.isConsumable">
          <h4 class="text-xl">Spell Details</h4>
          <div v-html="makePropertiesHtml(viewedSpell?.system.spell)"></div>
          <div v-html="removeUUIDs(viewedSpell?.system.spell.system.description?.value)"></div>
          <hr />
          <h4 class="pt-1 text-xl">Wand Details</h4>
        </div>
        <div v-html="makePropertiesHtml(viewedSpell!)"></div>
        <div v-html="removeUUIDs(viewedSpell?.system.description?.value)"></div>
      </template>
      <template #actionButtons>
        <Button
          ref="removeButton"
          label="Remove"
          class="!bg-red-600 !text-white hover:!bg-red-500"
          v-if="infoModal.options?.entry?.system.prepared?.value === 'prepared'"
          @click="setSpellAndClose(infoModal.options, null)"
        />
        <Button
          ref="castButton"
          label="Cast"
          v-if="!infoModal.options?.isConsumable"
          type="button"
          class="!bg-blue-600 !text-white hover:!bg-blue-500"
          @click="doSpell(viewedSpell!._id, infoModal.options)"
        />
        <Button
          ref="consumeButton"
          label="Use"
          v-if="infoModal.options?.isConsumable"
          type="button"
          class="!bg-green-600 !text-white hover:!bg-green-500"
          @click="doConsumable(viewedSpell!._id)"
        />
      </template>
    </InfoModal>
    <Modal ref="spellSelectionModal" title="Select a spell">
      <ul>
        <li
          class="cursor-pointer"
          v-for="spell in actor?.items.filter(
            (i) =>
              i.type === 'spell' &&
              i.system.location.value === spellSelectionModal.options?.entryId &&
              i.system.level.value <= spellSelectionModal.options.castingRank
          )"
          @click="setSpellAndClose(spellSelectionModal.options, spell._id)"
        >
          {{ spell.name }}
        </li>
      </ul>
    </Modal>
  </Teleport>
</template>
