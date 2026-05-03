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
  [key: string]: { [key: string]: (Spell | undefined)[] }
}
interface SpellInfo {
  entry?: SpellcastingEntry
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

const viewedSpell = ref<Spell | undefined>()
const viewedConsumable = ref<Item | undefined>()
const viewedItem = computed(() => viewedSpell.value ?? viewedConsumable.value)
const viewedSpellInfo = ref<SpellInfo | undefined>()

function openSpellModal(id: string | undefined, info: SpellInfo) {
  if (info.isConsumable) {
    viewedConsumable.value = spellConsumables.value?.find((i) => i._id === id)
    viewedSpell.value = undefined
  } else {
    viewedSpell.value = spells.value?.find((i) => i._id === id)
    viewedConsumable.value = undefined
  }
  viewedSpellInfo.value = info
  infoModal.value.open()
}

const staffSpellsByRank = computed(() =>
  (staff.value?.spells ?? []).reduce<Record<number, Spell[]>>((acc, s) => {
    const rank = s.system.traits.value?.includes('cantrip') ? 0 : (s.system.level.value ?? 0)
    ;(acc[rank] ??= []).push(s)
    return acc
  }, {})
)

function fillPreparedSlots(
  sb: Spellbook,
  locationId: string,
  location: SpellcastingEntry,
  allSpells: Spell[]
) {
  Object.values(location.system.slots).forEach((slot, slotRank) => {
    const preparedSpells = slot.prepared.map((slotSpell) =>
      allSpells.find((i) => i._id === slotSpell.id)
    )
    sb[locationId][slotRank] = Object.assign(new Array(slot.max), preparedSpells.slice(0, slot.max))
  })
}

function fillAndSortSpells(
  sb: Spellbook,
  locationId: string,
  location: SpellcastingEntry | undefined,
  allSpells: Spell[]
) {
  allSpells
    .filter((s) => s.type === 'spell' && s.system.location.value === locationId)
    .forEach((s) => {
      const rank = s.system.traits.value?.includes('cantrip') ? '0' : String(s.system.level.value)
      sb[locationId][rank].push(s)
      if (s.system.location.signature) {
        Object.values(location?.system?.slots ?? {}).forEach((slot, slotRank) => {
          if (slot.max && slotRank > (s.system.level.value ?? NaN)) {
            sb[locationId][slotRank].push(s)
          }
        })
      }
    })
  Object.entries(sb[locationId]).forEach(([rankStr, rankSpells]) => {
    rankSpells
      .sort((a, b) => (a?.system.level.value ?? NaN) - (b?.system.level.value ?? NaN))
      .sort(
        (a, b) =>
          (a?.system.level.value == Number(rankStr) ? 0 : 1) -
          (b?.system.level.value == Number(rankStr) ? 0 : 1)
      )
  })
}

const spellbook = computed((): Spellbook => {
  const sb: Spellbook = {}
  spellcastingEntries.value?.forEach((se) => {
    // prettier-ignore
    sb[se._id ?? ''] = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [], '8': [], '9': [], '10': [] }
  })
  const allSpells = spells.value ?? []
  for (const locationId of Object.keys(sb)) {
    const location = spellcastingEntries.value?.find((i) => i._id === locationId)
    if (location?.system.prepared.value === 'prepared' && location?.system?.prepared?.flexible === false) {
      fillPreparedSlots(sb, locationId, location, allSpells)
    } else {
      fillAndSortSpells(sb, locationId, location, allSpells)
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
                    openSpellModal(spell?._id, {
                      entry: location,
                      entryId: location._id,
                      castingRank: Number(rank),
                      castingSlot: index
                    })
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
          <li v-for="(rankSpells, rank) in staffSpellsByRank" class="mb-1" :key="'rank' + rank">
            <h4 class="flex justify-between px-4 align-bottom text-sm italic">
              <span class="pr-1">
                {{ rank == '0' ? 'Cantrips' : 'Rank ' + rank }}
              </span>
            </h4>
            <div
              v-for="item in rankSpells"
              class="flex cursor-pointer justify-between px-4"
              :key="item._id"
              @click="openSpellModal(item?._id, { fromStaff: true })"
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
                @click="openSpellModal(item?._id, { isConsumable: true })"
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
        :itemId="viewedItem?._id"
        :imageUrl="viewedItem?.img"
        :traits="viewedItem?.system?.traits?.value"
      >
        <template #title>
          {{ viewedItem?.name }}
          <ActionIcons
            class="relative -mt-[.5rem] pl-1 text-2xl leading-4"
            :actions="viewedSpell?.system?.time?.value"
          />
        </template>
        <template #description>
          {{
            viewedItem?.system.traits?.value?.includes('cantrip')
              ? `Cantrip`
              : `Rank ${viewedItem?.system.level?.value}`
          }}
          <span class="text-sm capitalize">{{ viewedItem?.system.traits.rarity }}</span>
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
            <ParsedDescription :text="viewedConsumable?.system.spell.system.description?.value" />
            <hr />
            <h4 class="pt-1 text-xl">Wand Details</h4>
          </div>
          <ParsedDescription :text="viewedItem?.system.description?.value" />
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
                viewedSpell
                  ?.doSpell?.(viewedSpellInfo?.castingRank, viewedSpellInfo?.castingSlot)
                  ?.then(() => infoModal.close())
            "
          />
          <Button
            label="Use"
            color="green"
            v-if="viewedSpellInfo?.isConsumable"
            :clicked="() => viewedConsumable?.consumeItem?.()?.then(() => infoModal.close())"
          />
        </template>
      </InfoModal>
      <Modal ref="spellSelectionModal" title="Select a spell">
        <ul>
          <li
            class="cursor-pointer"
            v-for="spell in spells?.filter(
              (i) =>
                i.system.location.value === spellSelectionModal.options?.entryId &&
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
