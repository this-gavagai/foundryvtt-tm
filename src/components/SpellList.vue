<script setup lang="ts">
// TODO: make staff spells castable
import type { SpellcastingEntry, Spell, Consumable } from '@/composables/character'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import { SignedNumber } from '@/utils/utilities'
import type { Modifier } from '@/composables/character'
import type { Roll } from '@/types/roll-types'
import type { RequestResolutionArgs } from '@/types/api-types'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'

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

const { t } = useI18n()
const character = useInjectedCharacter()
const {
  spellcastingEntries,
  spells,
  spellConsumables,
  spellDC,
  staff,
  inventory,
  rollOptionLabels
} = character
const { max: focusMax, current: focusCurrent } = character.focusPoints

const { isListening } = storeToRefs(useListenersStore())

const infoModal = ref()
const spellRollModal = ref()
const spellSelectionModal = ref()
const description = ref()

const viewedSpell = ref<Spell | undefined>()
const viewedConsumable = ref<Consumable | undefined>()
const viewedEntry = ref<SpellcastingEntry | undefined>()
const viewedItem = computed(() => viewedSpell.value ?? viewedConsumable.value)
const viewedModalItem = computed(() => viewedItem.value ?? viewedEntry.value)
const viewedSpellInfo = ref<SpellInfo | undefined>()

interface SpellRollView {
  spell: Spell
  entry?: SpellcastingEntry
  castingRank?: number
  phase: 'attack' | 'damage'
  map: 0 | 1 | 2
}
const viewedSpellRoll = ref<SpellRollView | undefined>()
const spellRollDamageData = ref<
  { formula?: string | null; breakdown?: string[]; modifiers?: Modifier[] } | undefined
>()

function pickSpellRoll(
  spell: Spell,
  entry: SpellcastingEntry | undefined,
  castingRank: number | undefined,
  phase: 'attack' | 'damage',
  map: 0 | 1 | 2
) {
  viewedSpellRoll.value = { spell, entry, castingRank, phase, map }
  spellRollDamageData.value = undefined
  spellRollModal.value?.open()
}

// Fetch the damage formula whenever the modal enters damage phase. The
// formula is rank-aware (heightening), so we re-fetch on rank changes too.
watch(viewedSpellRoll, async (v) => {
  if (!v || v.phase !== 'damage' || !isListening.value) {
    spellRollDamageData.value = undefined
    return
  }
  const result = (await v.spell.getDamage?.(v.castingRank)) as
    | (RequestResolutionArgs & {
        response?: { formula?: string | null; breakdown?: string[]; modifiers?: Modifier[] }
      })
    | null
  spellRollDamageData.value = result?.response
})

const spellRollDamageDice = computed<string[]>(() => {
  const f = spellRollDamageData.value?.formula
  return f ? parseDamageFormulaDice(f) : []
})

function attackNumberForMap(m: 0 | 1 | 2): 1 | 2 | 3 {
  return (m + 1) as 1 | 2 | 3
}

const spellRollRolls = computed<Roll[]>(() => {
  const v = viewedSpellRoll.value
  if (!v || !isListening.value) return []
  if (v.phase === 'attack') {
    const suffix = v.map === 0 ? '' : v.map === 1 ? ' -5' : ' -10'
    return [
      {
        key: 'spell-attack',
        label: t('spells.attack') + suffix,
        color: 'blue',
        dice: ['d20'],
        armed: true,
        execute: (faces) => v.spell.doSpellAttack!(attackNumberForMap(v.map), faces?.[0])
      }
    ]
  }
  const dice = spellRollDamageDice.value
  return [
    {
      key: 'spell-damage',
      label: t('spells.damage'),
      color: 'red',
      dice: dice.length ? dice : undefined,
      execute: (faces) =>
        v.spell.doSpellDamage!(
          v.map,
          faces && dice.length ? makeDiceResults(dice, faces) : undefined
        )
    }
  ]
})

const inlineRolls = useRollsFromActiveRoll(computed(() => description.value?.activeRoll))

// When the spellcasting-entry modal is open and the entry has a spell attack,
// the entry contributes a Roll. Otherwise the modal shows inline rolls only.
const spellRolls = computed<Roll[]>(() => {
  const entry = viewedEntry.value
  if (entry && !viewedItem.value && entry.doSpellAttack && isListening.value) {
    return [
      {
        key: 'spell-attack',
        label: t('spells.rollSpellAttack'),
        color: 'blue',
        dice: ['d20'],
        armed: true,
        execute: (faces) => entry.doSpellAttack!(faces?.[0])
      }
    ]
  }
  return inlineRolls.value
})

function openSpellModal(id: string | undefined, info: SpellInfo) {
  viewedEntry.value = undefined
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

function openEntryModal(entry: SpellcastingEntry) {
  viewedEntry.value = entry
  viewedSpell.value = undefined
  viewedConsumable.value = undefined
  viewedSpellInfo.value = undefined
  infoModal.value.open()
}

function clearPreparedSpell() {
  spellcastingEntries.value
    ?.find((e) => e._id === viewedSpellInfo.value?.entryId)
    ?.setPrepared?.(viewedSpellInfo.value?.castingRank, viewedSpellInfo.value?.castingSlot, null)
    ?.then(() => infoModal.value?.close())
}

function castViewedSpell() {
  return viewedSpell.value
    ?.doSpell?.(viewedSpellInfo.value?.castingRank, viewedSpellInfo.value?.castingSlot)
    ?.then(() => infoModal.value.close())
}

function consumeViewedSpellItem() {
  return viewedConsumable.value?.consumeItem?.()?.then(() => infoModal.value.close())
}

const castDisabled = computed(() => {
  const info = viewedSpellInfo.value
  if (!info) return false

  if (info.fromStaff) {
    if ((info.castingRank ?? 0) === 0) return false
    return !!staff.value?.expended || (staff.value?.charges?.value ?? 0) <= 0
  }

  const entry = spellcastingEntries.value?.find((e) => e._id === info.entryId)
  if (!entry) return false

  const prepType = entry.system.prepared.value
  const rank = info.castingRank ?? 0

  if (rank === 0) return false
  if (prepType === 'innate') return false

  if (prepType === 'focus') {
    return (focusCurrent.value ?? 0) <= 0
  }

  if (prepType === 'prepared' && entry.system.prepared.flexible === false) {
    const slot = info.castingSlot
    if (slot == null) return false
    return entry.system.slots['slot' + rank]?.prepared[slot]?.expended === true
  }

  return (entry.system.slots['slot' + rank]?.value ?? 0) <= 0
})

function setPreparedSpell(spell: Spell) {
  return spellcastingEntries.value
    ?.find((e) => e._id === spellSelectionModal.value?.options?.entryId)
    ?.setPrepared?.(
      spellSelectionModal.value?.options?.castingRank,
      spellSelectionModal.value?.options?.castingSlot,
      spell._id ?? null
    )
    ?.then(() => spellSelectionModal.value?.close())
}

const staffSpellsByRank = computed(() =>
  (staff.value?.spells ?? []).reduce<Record<string, Spell[]>>((acc, s) => {
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
    if (
      location?.system.prepared.value === 'prepared' &&
      location?.system?.prepared?.flexible === false
    ) {
      fillPreparedSlots(sb, locationId, location, allSpells)
    } else {
      fillAndSortSpells(sb, locationId, location, allSpells)
    }
  }
  return sb
})
</script>
<template>
  <div data-component="SpellList">
    <div v-if="spellcastingEntries?.length === 0" class="px-6 py-4 italic">
      {{ $t('spells.noSpells') }}
    </div>
    <div v-else class="px-6 py-4 lg:columns-2">
      <!-- Spell Sources -->
      <section
        v-for="location in spellcastingEntries"
        :data-section="
          location.system.prepared.value === 'focus'
            ? 'focus'
            : location.system.tradition?.value || 'arcane'
        "
        class="mb-4 break-inside-avoid-column"
        :key="location._id"
      >
        <h3 class="flex justify-between px-4 py-2 align-bottom">
          <span>
            <span class="cursor-pointer text-xl" @click="openEntryModal(location)">
              {{ location.name }}
            </span>
            <span v-if="location.system.spelldc.dc || spellDC" class="text-xs">
              (DC {{ location.system.spelldc.dc || spellDC }})
            </span>
          </span>
          <span class="pl-1">
            <CounterWidget
              v-if="location.system?.prepared.value === 'focus'"
              class="relative -bottom-0.5 mt-px mr-2 h-4 text-sm"
              :value="focusCurrent"
              :max="focusMax"
              :title="$t('spells.focusPool')"
              editable
              @change-count="(newTotal) => (focusCurrent = newTotal)"
            />
          </span>
        </h3>
        <!-- Spell Ranks -->
        <section
          v-for="(spells, rank) in spellbook[location._id ?? '']"
          class="[section:not(.hidden)~&]:mt-3"
          :class="{ hidden: !spells.length }"
          :key="'rank' + rank"
        >
          <h4 class="flex justify-between px-4 align-bottom text-sm italic">
            <span class="pr-1">
              {{ rank == '0' ? $t('spells.cantrips') : $t('spells.rank', { n: rank }) }}
            </span>
            <CounterWidget
              class="relative bottom-px -m-0.5 mr-2 h-4 pb-1 text-sm"
              v-if="
                location.system?.prepared.value === 'spontaneous' ||
                (location.system?.prepared?.value === 'prepared' &&
                  location?.system?.prepared?.flexible === true)
              "
              :value="location.system.slots?.['slot' + rank]?.value"
              :max="location.system.slots?.['slot' + rank]?.max"
              editable
              :title="`${location?.name}: ${$t('spells.rank', { n: rank })}`"
              @change-count="(newTotal) => location?.setSlotCount?.(Number(rank), newTotal)"
            />
          </h4>
          <!-- Spells -->
          <ul class="mb-1 empty:hidden">
            <li
              v-for="(spell, index) in spells"
              class="flex flex-wrap items-center justify-between gap-x-2 px-4 py-px"
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
              <div
                v-if="
                  isListening &&
                  spell &&
                  (spell.system?.traits?.value?.includes('attack') || spell.system?.hasDamage)
                "
                data-part="spell-roll-buttons"
                class="flex flex-1 flex-wrap items-center justify-end gap-1 text-xs"
              >
                <span
                  data-part="attack"
                  v-if="spell.system?.traits?.value?.includes('attack')"
                  class="flex gap-1"
                >
                  <span
                    class="inline-block cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 whitespace-nowrap text-blue-600 transition-colors select-none active:bg-gray-300"
                    @click="pickSpellRoll(spell, location, Number(rank), 'attack', 0)"
                    >{{ $t('spells.attack') }}</span
                  >
                  <span
                    class="inline-block w-9 cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 text-center text-blue-600 transition-colors select-none active:bg-gray-300"
                    @click="pickSpellRoll(spell, location, Number(rank), 'attack', 1)"
                    >-5</span
                  >
                  <span
                    class="inline-block w-9 cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 text-center text-blue-600 transition-colors select-none active:bg-gray-300"
                    @click="pickSpellRoll(spell, location, Number(rank), 'attack', 2)"
                    >-10</span
                  >
                </span>
                <span data-part="damage" v-if="spell.system?.hasDamage" class="flex gap-1">
                  <span
                    class="inline-block cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 whitespace-nowrap text-red-600 transition-colors select-none active:bg-gray-300"
                    @click="pickSpellRoll(spell, location, Number(rank), 'damage', 0)"
                    >{{ $t('spells.damage') }}</span
                  >
                </span>
              </div>
              <CounterWidget
                class="mr-2 h-3 self-center text-sm [&>div]:mt-0"
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
                :title="`${$t('spells.rank', { n: rank })}: ${spell?.name}`"
                @change-count="
                  (newTotal) =>
                    location?.setPrepared?.(
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
        data-section="staff"
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
            class="relative -bottom-0.5 mt-px mr-2 h-4 text-sm"
            :value="staff?.charges?.value"
            :max="staff?.charges?.max"
            :title="inventory?.find((i) => i._id === staff?.staffId)?.name + ' charges'"
            editable
            @change-count="(newTotal) => staff?.setStaffCharges?.(newTotal)"
          />
        </h3>
        <section
          v-for="(rankSpells, rank) in staffSpellsByRank"
          class="[section:not(.hidden)~&]:mt-3"
          :key="'rank' + rank"
        >
          <h4 class="flex justify-between px-4 align-bottom text-sm italic">
            <span class="pr-1">
              {{ rank == '0' ? $t('spells.cantrips') : $t('spells.rank', { n: rank }) }}
            </span>
          </h4>
          <ul class="mb-1 empty:hidden">
            <li
              v-for="item in rankSpells"
              class="flex flex-wrap items-center justify-between gap-x-2 px-4 py-px"
              :key="item._id"
            >
              <div class="text-md">
                <span
                  class="cursor-pointer"
                  @click="openSpellModal(item?._id, { fromStaff: true, castingRank: Number(rank) })"
                >
                  <span>{{ item.name }}</span>
                  <ActionIcons class="text-md ml-1" :actions="item?.system?.time?.value" />
                </span>
              </div>
              <div
                v-if="
                  isListening &&
                  (item.system?.traits?.value?.includes('attack') || item.system?.hasDamage)
                "
                data-part="spell-roll-buttons"
                class="flex flex-1 flex-wrap items-center justify-end gap-1 text-xs"
              >
                <span
                  data-part="attack"
                  v-if="item.system?.traits?.value?.includes('attack')"
                  class="flex gap-1"
                >
                  <span
                    class="inline-block cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 whitespace-nowrap text-blue-600 transition-colors select-none active:bg-gray-300"
                    @click="pickSpellRoll(item, undefined, Number(rank), 'attack', 0)"
                    >{{ $t('spells.attack') }}</span
                  >
                  <span
                    class="inline-block w-9 cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 text-center text-blue-600 transition-colors select-none active:bg-gray-300"
                    @click="pickSpellRoll(item, undefined, Number(rank), 'attack', 1)"
                    >-5</span
                  >
                  <span
                    class="inline-block w-9 cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 text-center text-blue-600 transition-colors select-none active:bg-gray-300"
                    @click="pickSpellRoll(item, undefined, Number(rank), 'attack', 2)"
                    >-10</span
                  >
                </span>
                <span data-part="damage" v-if="item.system?.hasDamage" class="flex gap-1">
                  <span
                    class="inline-block cursor-pointer border border-gray-400 bg-gray-100 px-2 py-1 whitespace-nowrap text-red-600 transition-colors select-none active:bg-gray-300"
                    @click="pickSpellRoll(item, undefined, Number(rank), 'damage', 0)"
                    >{{ $t('spells.damage') }}</span
                  >
                </span>
              </div>
            </li>
          </ul>
        </section>
      </section>
      <!-- Wands and Scrolls -->
      <section
        data-section="consumables"
        class="mt-4 break-inside-avoid-column [&:not(:has(li))]:hidden"
      >
        <h3 class="flex justify-between px-4 py-2 align-bottom">
          <span>
            <span class="text-xl"> {{ $t('spells.wandsAndScrolls') }} </span>
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
        :itemId="viewedModalItem?._id"
        :imageUrl="viewedModalItem?.img"
        :traits="viewedEntry && !viewedItem ? [] : viewedItem?.system?.traits?.value"
        :rolls="spellRolls"
      >
        <template #title>
          {{ viewedModalItem?.name }}
          <ActionIcons
            v-if="viewedSpell"
            class="relative -mt-2 pl-1 text-2xl leading-4"
            :actions="viewedSpell?.system?.time?.value"
          />
        </template>
        <template #description>
          <template v-if="viewedEntry && !viewedItem">
            <span v-if="viewedEntry.spellAttackModifier != null">
              {{ $t('spells.spellAttack') }}
              {{ viewedEntry.spellAttackModifier >= 0 ? '+' : ''
              }}{{ viewedEntry.spellAttackModifier }}
            </span>
          </template>
          <template v-else>
            {{
              viewedItem?.system.traits?.value?.includes('cantrip')
                ? $t('spells.cantrips')
                : $t('spells.rank', { n: viewedItem?.system.level?.value })
            }}
            <span class="text-sm capitalize">{{ viewedItem?.system.traits.rarity }}</span>
          </template>
        </template>
        <template #body>
          <template v-if="viewedEntry && !viewedItem">
            <ul>
              <li
                v-for="mod in (viewedEntry.spellAttackModifiers ?? []).filter(
                  (m: Modifier) => m.enabled || !m.hideIfDisabled
                )"
                data-part="modifier"
                :data-disabled="!mod.enabled || undefined"
                class="flex gap-2"
                :class="{ 'text-gray-300': !mod.enabled }"
                :key="'mod_' + mod.slug"
              >
                <div class="w-8 text-right">{{ SignedNumber.format(mod.modifier ?? 0) }}</div>
                <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
              </li>
            </ul>
          </template>
          <template v-else-if="!viewedEntry || viewedItem">
            <div class="flex gap-2 empty:hidden">
              <div v-if="viewedSpell?.system?.range">
                <span class="font-bold">{{ $t('spells.range') }}:</span>
                {{ viewedSpell?.system?.range }}
              </div>
              <div v-if="viewedSpell?.system?.area?.value && viewedSpell?.system?.area?.type">
                <span class="font-bold">{{ $t('spells.area') }}:</span>
                {{ viewedSpell?.system?.area?.value }}-{{ $t('spells.foot') }}
                {{ viewedSpell?.system?.area?.type }}
              </div>
              <div v-if="viewedSpell?.system?.target">
                <span class="font-bold">{{ $t('spells.target') }}:</span>
                {{ viewedSpell?.system?.target }}
              </div>
            </div>
            <div class="flex [&:not(:has(span))]:hidden">
              <label class="font-bold">{{ $t('spells.defense') }}:&nbsp;</label>
              <span v-if="viewedSpell?.system?.defense?.save?.statistic">
                <span v-if="viewedSpell?.system?.defense?.save?.basic"
                  >{{ $t('spells.basic') }}&nbsp;</span
                >
                <span class="capitalize">{{ viewedSpell?.system?.defense?.save?.statistic }}</span>
              </span>
              <span v-if="viewedSpell?.system?.traits?.value?.includes('attack')">{{
                $t('spells.ac')
              }}</span>
            </div>
            <div v-if="viewedSpellInfo?.isConsumable">
              <h4 class="text-xl">{{ $t('spells.spellDetails') }}</h4>
              <ParsedDescription
                :text="viewedConsumable?.system.spell.system.description?.value"
                :labels="rollOptionLabels"
              />
              <hr />
              <h4 class="pt-1 text-xl">{{ $t('spells.wandDetails') }}</h4>
            </div>
            <ParsedDescription
              ref="description"
              :text="viewedItem?.system.description?.value"
              :labels="rollOptionLabels"
            />
          </template>
        </template>
        <template #actionButtons v-if="isListening">
          <Button
            :label="$t('common.remove')"
            color="red"
            v-if="viewedSpellInfo?.entry?.system.prepared?.value === 'prepared'"
            :clicked="clearPreparedSpell"
          />
          <Button
            :label="$t('spells.cast')"
            color="blue"
            v-if="!viewedSpellInfo?.isConsumable && viewedItem"
            :disabled="castDisabled"
            :clicked="castViewedSpell"
          />
          <Button
            :label="$t('common.use')"
            color="green"
            v-if="viewedSpellInfo?.isConsumable"
            :clicked="consumeViewedSpellItem"
          />
        </template>
      </InfoModal>
      <InfoModal
        ref="spellRollModal"
        :itemId="viewedSpellRoll?.spell?._id"
        :imageUrl="viewedSpellRoll?.spell?.img"
        :traits="viewedSpellRoll?.spell?.system?.traits?.value"
        :rolls="spellRollRolls"
      >
        <template #title>
          {{ viewedSpellRoll?.spell?.name }}
          <ActionIcons
            v-if="viewedSpellRoll?.spell"
            class="relative -mt-2 pl-1 text-2xl leading-4"
            :actions="viewedSpellRoll?.spell?.system?.time?.value"
          />
        </template>
        <template #description>
          <span v-if="viewedSpellRoll?.phase === 'attack'">
            {{ $t('spells.spellAttack') }}
            <span v-if="viewedSpellRoll?.entry?.spellAttackModifier != null">
              {{ viewedSpellRoll?.entry?.spellAttackModifier >= 0 ? '+' : ''
              }}{{ viewedSpellRoll?.entry?.spellAttackModifier }}
            </span>
            <span v-if="viewedSpellRoll?.map" class="ml-1 text-sm">
              ({{ viewedSpellRoll.map === 1 ? '-5' : '-10' }})
            </span>
          </span>
          <span v-else-if="viewedSpellRoll?.phase === 'damage'">
            {{ $t('spells.damage') }}
            <span v-if="viewedSpellRoll?.castingRank" class="ml-1 text-sm">
              ({{ $t('spells.rank', { n: viewedSpellRoll.castingRank }) }})
            </span>
          </span>
        </template>
        <template #body>
          <ul v-if="viewedSpellRoll?.phase === 'attack' && viewedSpellRoll?.entry">
            <li
              v-for="mod in (viewedSpellRoll.entry.spellAttackModifiers ?? []).filter(
                (m: Modifier) => m.enabled || !m.hideIfDisabled
              )"
              data-part="modifier"
              :data-disabled="!mod.enabled || undefined"
              class="flex gap-2"
              :class="{ 'text-gray-300': !mod.enabled }"
              :key="'spellrollmod_' + mod.slug"
            >
              <div class="w-8 text-right">{{ SignedNumber.format(mod.modifier ?? 0) }}</div>
              <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
            </li>
          </ul>
          <template v-else-if="viewedSpellRoll?.phase === 'damage'">
            <div v-if="spellRollDamageData?.formula" class="font-mono text-sm">
              {{ spellRollDamageData.formula }}
            </div>
            <ul class="mt-2">
              <li
                v-for="(line, i) in spellRollDamageData?.breakdown ?? []"
                class="text-sm"
                :key="'breakdown_' + i"
              >
                {{ line }}
              </li>
            </ul>
          </template>
        </template>
      </InfoModal>
      <Modal ref="spellSelectionModal" :title="$t('spells.selectSpell')">
        <ul>
          <li
            class="cursor-pointer"
            v-for="spell in spells?.filter(
              (i) =>
                i.system.location.value === spellSelectionModal.options?.entryId &&
                (i.system.level.value ?? 0) <= spellSelectionModal.options.castingRank
            )"
            @click="setPreparedSpell(spell)"
            :key="spell._id"
          >
            {{ spell.name }}
          </li>
        </ul>
      </Modal>
    </Teleport>
  </div>
</template>
