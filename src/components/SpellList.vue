<script setup lang="ts">
// TODO: make staff spells castable
import type { SpellcastingEntry, Spell, Item } from '@/composables/character'
import { inject, computed, ref } from 'vue'
import { useKeys } from '@/composables/injectKeys'
import { useListeners } from '@/composables/listenersOnline'

import Button from '@/components/widgets/ButtonWidget.vue'
import CounterWidget from '@/components/widgets/CounterWidget.vue'
import Modal from '@/components/ModalBox.vue'
import InfoModal from '@/components/InfoModal.vue'
import ActionIcons from '@/components/widgets/ActionIcons.vue'
import ParsedDescription from './ParsedDescription.vue'

interface Spellbook {
  [key: string]: { [key: string]: [Item?] }
}
interface SpellInfo {
  type?: 'focus' | 'charge' | 'spontaneous' | 'prepared' | 'wand'
  entry?: Spell
  entryId?: string
  castingRank?: number
  castingSlot?: number
  isConsumable?: boolean
  fromStaff?: boolean
}

const character = inject(useKeys().characterKey)!
const { spellcastingEntries, spells, spellConsumables, spellDC, staff, inventory } = character
const { max: focusMax, current: focusCurrent } = character.focusPoints

const { isListening } = useListeners()

const infoModal = ref()
const spellSelectionModal = ref()

const viewedSpellId = ref<string | undefined>()
const viewedSpell = computed(() =>
  [...(spells.value ?? []), ...(spellConsumables.value ?? [])]?.find(
    (i: Spell) => i._id === viewedSpellId.value
  )
)
const viewedSpellInfo = ref<SpellInfo | undefined>()

const spellbook = computed((): Spellbook => {
  const sb: Spellbook = {} // {location - rank - spell}
  // set spellcastingEntry locations with empty ranks template
  spellcastingEntries.value?.forEach((se: SpellcastingEntry) => {
    const location = se._id ?? ''
    // prettier-ignore
    sb[location] = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': [] }
  })
  // assign spells to spellbook ranks
  for (const locationId of Object.keys(sb)) {
    const location = spellcastingEntries.value?.find((i: Item) => i._id === locationId)
    if (
      location?.system.prepared.value === 'prepared' &&
      location?.system?.prepared?.flexible === false
    ) {
      Object.values(location.system.slots).forEach((slot, slotRank: number) => {
        const preparedSpells = slot.prepared.map((slotSpell) =>
          spells.value?.find((i: Item) => i._id === slotSpell.id)
        )
        const spellSlots = Object.assign(new Array(slot.max), preparedSpells.slice(0, slot.max))
        sb[locationId][slotRank] = spellSlots as [Item]
      })
    } else {
      const spellsForLocation = spells.value?.filter(
        (i: Item) => i.type === 'spell' && i.system.location.value === locationId
      )
      spellsForLocation?.forEach((s: Item) => {
        const rank = s.system.traits.value?.includes('cantrip') ? '0' : String(s.system.level.value)
        sb[locationId][rank].push(s)
        // add signature spells by iterating through spellslots property
        if (s.system.location.signature) {
          Object.values(location?.system?.slots ?? {}).forEach((slot, slotRank) => {
            if (slot.max && slotRank > (s.system.level.value ?? NaN)) {
              sb[locationId][slotRank].push(s)
            }
          })
        }
      })
      // put signature spells at the end
      const spellRanks = Object.entries(sb[locationId]) as [string, [(Item | undefined)?]][]
      spellRanks.forEach((rank: [string, [(Item | undefined)?]]) => {
        rank[1]
          .sort(
            (a: Item | undefined, b: Item | undefined) =>
              (a?.system.level.value ?? NaN) - (b?.system.level.value ?? NaN)
          )
          .sort(
            (a: Item | undefined, b: Item | undefined) =>
              (a?.system.level.value == Number(rank[0]) ? 0 : 1) -
              (b?.system.level.value == Number(rank[0]) ? 0 : 1)
          )
      })
    }
  }
  return sb
})
</script>
<template>
  <div>
    <div v-if="spellcastingEntries?.length === 0" class="px-6 py-4 italic">
      This character does not cast spells.
    </div>
    <div v-else class="lg:columns-2 lg:gap-12 2xl:columns-3">
      <!-- Spell Sources -->
      <section
        v-for="location in spellcastingEntries"
        class="mb-4 break-inside-avoid-column"
        :key="location._id"
      >
        <h3 class="flex justify-between px-4 py-2 align-bottom">
          <span>
            <span class="text-xl">
              {{ location.name }}
            </span>
            <span v-if="location.system.spelldc.dc || spellDC" class="text-xs">
              (DC {{ location.system.spelldc.dc || spellDC }})
            </span>
          </span>
          <span class="pl-1">
            <CounterWidget
              v-if="location.system?.prepared.value === 'focus'"
              class="relative bottom-[-2px] mt-[1px] mr-2 h-4 text-sm"
              :value="focusCurrent"
              :max="focusMax"
              title="Focus Pool"
              editable
              @change-count="(newTotal) => (focusCurrent = newTotal)"
            />
          </span>
        </h3>
        <!-- Spell Ranks -->
        <section
          v-for="(spells, rank) in spellbook[location._id ?? '']"
          class=""
          :class="{ hidden: !spells.length }"
          :key="'rank' + rank"
        >
          <h4 class="flex justify-between px-4 align-bottom text-sm italic">
            <span class="pr-1">
              {{ rank == '0' ? 'Cantrips' : 'Rank ' + rank }}
            </span>
            <CounterWidget
              class="relative bottom-[-1px] -m-[2px] mr-2 h-4 pb-1 text-sm"
              v-if="
                location.system?.prepared.value === 'spontaneous' ||
                (location.system?.prepared?.value === 'prepared' &&
                  location?.system?.prepared?.flexible === true)
              "
              :value="location.system.slots?.['slot' + rank]?.value"
              :max="location.system.slots?.['slot' + rank]?.max"
              editable
              :title="`${location?.name}: Rank ${rank}`"
              @change-count="(newTotal) => location?.setSlotCount?.(Number(rank), newTotal)"
            />
          </h4>
          <!-- Spells -->
          <ul class="mb-1 empty:hidden">
            <li
              v-for="(spell, index) in spells"
              class="flex justify-between px-4"
              :key="spell?._id"
            >
              <div class="text-md">
                <span
                  v-if="spell"
                  @click="
                    () => {
                      viewedSpellId = spell?._id
                      viewedSpellInfo = {
                        entry: location,
                        entryId: location._id,
                        castingRank: Number(rank),
                        castingSlot: index
                      }
                      infoModal.open()
                    }
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
                  <ActionIcons class="text-md ml-1" :actions="spell?.system?.time?.value" />
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
              <CounterWidget
                class="mt-1 mr-2 h-3 text-sm"
                v-if="
                  location.system?.prepared.value === 'prepared' &&
                  location?.system?.prepared?.flexible === false &&
                  Number(rank) > 0
                "
                :value="
                  location.system.slots['slot' + rank].prepared[index]?.expended === false ? 1 : 0
                "
                :max="1"
                editable
                :title="`Rank ${rank}: ${spell?.name}`"
                @change-count="
                  (newTotal) =>
                    location?.setPrepared(
                      Number(rank),
                      index,
                      spell?._id ?? null,
                      newTotal ? false : true
                    )
                "
              />
            </li>
          </ul>
        </section>
      </section>
      <!-- Staff from PF2e-Dailies -->
      <section
        class="mt-4 break-inside-avoid-column [&:not(:has(li))]:hidden"
        v-if="staff?.staffId"
      >
        <h3 class="flex justify-between px-4 py-2 align-bottom">
          <span>
            <span class="text-xl">{{
              inventory?.find((i) => i._id === staff?.staffId)?.name
            }}</span>
            <span v-if="spellDC" class="text-xs"> (DC {{ spellDC }}) </span>
          </span>
          <CounterWidget
            class="relative bottom-[-2px] mt-[1px] mr-2 h-4 text-sm"
            :value="staff?.charges?.value"
            :max="staff?.charges?.max"
            :title="inventory?.find((i) => i._id === staff?.staffId)?.name + ' charges'"
            editable
            @change-count="(newTotal) => staff?.setStaffCharges?.(newTotal)"
          />
        </h3>
        <ul class="empty:hidden">
          <li v-for="(i, rank) in 10" class="mb-1 [&:not(:has(div))]:hidden" :key="'rank' + i">
            <h4 class="flex justify-between px-4 align-bottom text-sm italic">
              <span class="pr-1">
                {{ rank === 0 ? 'Cantrips' : 'Rank ' + rank }}
              </span>
            </h4>
            <div
              v-for="item in staff?.spells.filter((s) =>
                rank === 0
                  ? s.system.traits.value?.includes('cantrip')
                  : s.system.level.value === rank && !s.system.traits.value?.includes('cantrip')
              )"
              class="flex cursor-pointer justify-between px-4"
              :key="item._id"
              @click="
                () => {
                  viewedSpellId = item?._id
                  viewedSpellInfo = {
                    fromStaff: true
                  }
                  infoModal.open()
                }
              "
            >
              {{ item.name }}
            </div>
          </li>
        </ul>
      </section>
      <!-- Wands and Scrolls -->
      <section class="mt-4 break-inside-avoid-column [&:not(:has(li))]:hidden">
        <h3 class="flex justify-between px-4 py-2 align-bottom">
          <span>
            <span class="text-xl"> Wands and Scrolls </span>
            <span v-if="spellDC" class="text-xs"> (DC {{ spellDC }}) </span>
          </span>
        </h3>
        <ul class="pb-4 empty:hidden">
          <li
            v-for="item in spellConsumables?.sort(
              (a, b) =>
                (a.system.spell.system.level.value ?? 0) - (b.system.spell.system.level.value ?? 0)
            )"
            class="flex justify-between px-4"
            :key="item._id"
          >
            <div>
              <span
                v-if="item"
                @click="
                  () => {
                    viewedSpellId = item?._id
                    viewedSpellInfo = { isConsumable: true }
                    infoModal.open()
                  }
                "
                class="cursor-pointer"
              >
                {{ item.name }}
              </span>
            </div>
            <CounterWidget
              class="mt-1 mr-2 h-3 text-sm"
              :value="item.system.uses?.value"
              :max="item.system.uses?.max"
              :title="item.name"
              editable
              @change-count="(newTotal) => item?.changeUses?.(newTotal)"
            />
          </li>
        </ul>
      </section>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="infoModal"
        :itemId="viewedSpell?._id"
        :imageUrl="viewedSpell?.img"
        :traits="viewedSpell?.system?.traits?.value"
      >
        <template #title>
          {{ viewedSpell?.name }}
          <ActionIcons
            class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
            :actions="viewedSpell?.system?.time?.value"
          />
        </template>
        <template #description>
          {{
            viewedSpell?.system.traits?.value?.includes('cantrip')
              ? `Cantrip`
              : `Rank ${viewedSpell?.system.level?.value}`
          }}
          <span class="text-sm capitalize">{{ viewedSpell?.system.traits.rarity }}</span>
        </template>
        <template #body>
          <div class="flex gap-2 empty:hidden">
            <div v-if="viewedSpell?.system?.range">
              <span class="font-bold">Range:</span> {{ viewedSpell?.system?.range }}
            </div>
            <div v-if="viewedSpell?.system?.area?.value && viewedSpell?.system?.area?.type">
              <span class="font-bold">Area:</span> {{ viewedSpell?.system?.area?.value }}-foot
              {{ viewedSpell?.system?.area?.type }}
            </div>
            <div v-if="viewedSpell?.system?.target">
              <span class="font-bold">Target:</span> {{ viewedSpell?.system?.target }}
            </div>
          </div>
          <div class="flex [&:not(:has(span))]:hidden">
            <label class="font-bold">Defense:&nbsp;</label>
            <span v-if="viewedSpell?.system?.defense?.save?.statistic">
              <span>{{ viewedSpell?.system?.defense?.save?.basic ? 'basic&nbsp;' : '' }}</span>
              <span class="capitalize">{{ viewedSpell?.system?.defense?.save?.statistic }}</span>
            </span>
            <span v-if="viewedSpell?.system?.traits?.value?.includes('attack')">AC</span>
          </div>
          <div v-if="viewedSpellInfo?.isConsumable">
            <h4 class="text-xl">Spell Details</h4>
            <ParsedDescription :text="viewedSpell?.system.spell.system.description?.value" />
            <hr />
            <h4 class="pt-1 text-xl">Wand Details</h4>
          </div>
          <ParsedDescription :text="viewedSpell?.system.description?.value" />
        </template>
        <template #actionButtons v-if="isListening">
          <Button
            label="Remove"
            color="red"
            v-if="viewedSpellInfo?.entry?.system.prepared?.value === 'prepared'"
            :clicked="
              () => {
                spellcastingEntries
                  ?.find((e) => e._id === viewedSpellInfo?.entryId)
                  ?.setPrepared(viewedSpellInfo?.castingRank, viewedSpellInfo?.castingSlot, null)
                  .then(() => infoModal?.close())
              }
            "
          />
          <Button
            label="Cast"
            color="blue"
            v-if="!viewedSpellInfo?.isConsumable && !viewedSpellInfo?.fromStaff"
            :clicked="
              () =>
                (viewedSpell as Spell)
                  ?.doSpell?.(viewedSpellInfo?.castingRank, viewedSpellInfo?.castingSlot)
                  ?.then(() => infoModal.close())
            "
          />
          <Button
            label="Use"
            color="green"
            v-if="viewedSpellInfo?.isConsumable"
            :clicked="
              () => {
                viewedSpell?.consumeItem?.()?.then(() => infoModal.close())
              }
            "
          />
        </template>
      </InfoModal>
      <Modal ref="spellSelectionModal" title="Select a spell">
        <ul>
          <li
            class="cursor-pointer"
            v-for="spell in spells?.filter(
              (i) =>
                i.system.location === spellSelectionModal.options?.entryId &&
                (i.system.level.value ?? 0) <= spellSelectionModal.options.castingRank
            )"
            :clicked="
              () => {
                return spellcastingEntries
                  ?.find((e) => e._id === spellSelectionModal?.options?.entryId)
                  ?.setPrepared(
                    spellSelectionModal?.options?.castingRank,
                    spellSelectionModal?.options?.castingSlot,
                    spell._id ?? null
                  )
                  .then(() => spellSelectionModal?.close())
              }
            "
            :key="spell._id"
          >
            {{ spell.name }}
          </li>
        </ul>
      </Modal>
    </Teleport>
  </div>
</template>
