<script setup lang="ts">
import type { SpellcastingEntry, Spell, Consumable } from '@/composables/character'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import type { Modifier } from '@/composables/character'
import type { Roll } from '@/types/roll-types'
import type { RequestResolutionArgs } from '@/types/api-types'
import { useRollsFromActiveRoll } from '@/composables/useRollsFromActiveRoll'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'
import {
  MAX_SPELL_RANK,
  slotKey,
  isStrictPrepared,
  type Spellbook,
  type SpellInfo
} from '@/utils/spellcasting'

import Button from '@/components/widgets/ButtonWidget.vue'
import CounterWidget from '@/components/widgets/CounterWidget.vue'
import Modal from '@/components/ModalBox.vue'
import InfoModal from '@/components/InfoModal.vue'
import ActionIcons from '@/components/widgets/ActionIcons.vue'
import ModifierList from '@/components/ModifierList.vue'
import SpellSourceSection from '@/components/SpellSourceSection.vue'
import ParsedDescription from './ParsedDescription.vue'

const { t } = useI18n()
const character = useInjectedCharacter()
const {
  spellcastingEntries,
  spells,
  spellConsumables,
  spellDC,
  staff,
  inventory,
  rollOptionLabels,
  level: characterLevel
} = character
const { max: focusMax, current: focusCurrent } = character.focusPoints

const entryById = (id?: string | null) => spellcastingEntries.value?.find((e) => e._id === id)

const { isListening } = storeToRefs(useListenersStore())

const infoModal = ref<InstanceType<typeof InfoModal>>()
const spellRollModal = ref<InstanceType<typeof InfoModal>>()
const spellSelectionModal = ref<InstanceType<typeof Modal>>()
const description = ref<InstanceType<typeof ParsedDescription>>()

const viewedSpell = ref<Spell | undefined>()
const viewedConsumable = ref<Consumable | undefined>()
const viewedEntry = ref<SpellcastingEntry | undefined>()
const viewedItem = computed(() => viewedSpell.value ?? viewedConsumable.value)
const viewedModalItem = computed(() => viewedItem.value ?? viewedEntry.value)
const viewedSpellInfo = ref<SpellInfo | undefined>()
const viewedInfoEntry = computed(() => entryById(viewedSpellInfo.value?.entryId))

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
  // The fetch is async; if the viewed roll changed while it was in flight,
  // a stale response must not overwrite the current one.
  if (viewedSpellRoll.value !== v) return
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
          v.castingRank,
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
  infoModal.value?.open()
}

function openEntryModal(entry: SpellcastingEntry) {
  viewedEntry.value = entry
  viewedSpell.value = undefined
  viewedConsumable.value = undefined
  viewedSpellInfo.value = undefined
  infoModal.value?.open()
}

function clearPreparedSpell() {
  viewedInfoEntry.value
    ?.setPrepared?.(viewedSpellInfo.value?.castingRank, viewedSpellInfo.value?.castingSlot, null)
    ?.then(() => infoModal.value?.close())
}

// Roll-data context for the currently viewed spell, used by ParsedDescription
// to resolve inline @item.level / @actor.level refs in @Damage formulas
// client-side before the click handler ships them to Foundry.
const viewedSpellRollData = computed<Record<string, unknown>>(() => ({
  item: {
    level: viewedSpellInfo.value?.castingRank ?? viewedSpell.value?.system?.level?.value ?? 1
  },
  actor: { level: characterLevel.value }
}))
const viewedConsumableSpellRollData = computed<Record<string, unknown>>(() => ({
  item: { level: viewedConsumable.value?.system?.spell?.system?.level?.value ?? 1 },
  actor: { level: characterLevel.value }
}))

function castViewedSpell() {
  return viewedSpell.value
    ?.doSpell?.(viewedSpellInfo.value?.castingRank, viewedSpellInfo.value?.castingSlot)
    ?.then(() => infoModal.value?.close())
}

function consumeViewedSpellItem() {
  return viewedConsumable.value?.consumeItem?.()?.then(() => infoModal.value?.close())
}

const castDisabled = computed(() => {
  const info = viewedSpellInfo.value
  if (!info) return false

  if (info.fromStaff) {
    if ((info.castingRank ?? 0) === 0) return false
    return !!staff.value?.expended || (staff.value?.charges?.value ?? 0) <= 0
  }

  const entry = viewedInfoEntry.value
  if (!entry) return false

  const prepType = entry.system.prepared.value
  const rank = info.castingRank ?? 0

  if (rank === 0) return false
  if (prepType === 'innate') return false

  if (prepType === 'focus') {
    return (focusCurrent.value ?? 0) <= 0
  }

  if (isStrictPrepared(entry)) {
    const slot = info.castingSlot
    if (slot == null) return false
    return entry.system.slots[slotKey(rank)]?.prepared[slot]?.expended === true
  }

  return (entry.system.slots[slotKey(rank)]?.value ?? 0) <= 0
})

function setPreparedSpell(spell: Spell) {
  return entryById(spellSelectionModal.value?.options?.entryId)
    ?.setPrepared?.(
      spellSelectionModal.value?.options?.castingRank,
      spellSelectionModal.value?.options?.castingSlot,
      spell._id ?? null
    )
    ?.then(() => spellSelectionModal.value?.close())
}

const sortedConsumables = computed(() =>
  [...(spellConsumables.value ?? [])].sort(
    (a, b) => (a.system.spell.system.level.value ?? 0) - (b.system.spell.system.level.value ?? 0)
  )
)

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
    const rank = Number(rankStr)
    // Native-rank spells first, signature/heightened spells last; then by level.
    rankSpells.sort((a, b) => {
      const aLevel = a?.system.level.value ?? NaN
      const bLevel = b?.system.level.value ?? NaN
      const aSignature = aLevel === rank ? 0 : 1
      const bSignature = bLevel === rank ? 0 : 1
      return aSignature - bSignature || aLevel - bLevel
    })
  })
}

const spellbook = computed((): Spellbook => {
  const sb: Spellbook = {}
  spellcastingEntries.value?.forEach((se) => {
    sb[se._id ?? ''] = Object.fromEntries(
      Array.from({ length: MAX_SPELL_RANK + 1 }, (_, i): [string, (Spell | undefined)[]] => [
        String(i),
        []
      ])
    )
  })
  const allSpells = spells.value ?? []
  for (const locationId of Object.keys(sb)) {
    const location = spellcastingEntries.value?.find((i) => i._id === locationId)
    if (isStrictPrepared(location)) {
      fillPreparedSlots(sb, locationId, location!, allSpells)
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
    <div v-else class="px-6 py-4 xl:columns-2">
      <!-- Spell Sources -->
      <SpellSourceSection
        v-for="location in spellcastingEntries"
        :key="location._id"
        class="mb-4"
        :data-section="
          location.system.prepared.value === 'focus'
            ? 'focus'
            : location.system.tradition?.value || 'arcane'
        "
        :title="location.name ?? ''"
        :dc="location.system.spelldc.dc || spellDC"
        :ranks="spellbook[location._id ?? '']"
        :entry="location"
        title-clickable
        @open-entry="openEntryModal(location)"
        @open-spell="openSpellModal"
        @open-empty="(info) => spellSelectionModal?.open(info)"
        @pick="pickSpellRoll"
      >
        <template #headerCounter>
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
        </template>
      </SpellSourceSection>
      <!-- Staff from PF2e-Dailies -->
      <SpellSourceSection
        v-if="staff?.staffId"
        class="mt-4 [&:not(:has(li))]:hidden"
        data-section="staff"
        :title="inventory?.find((i) => i._id === staff?.staffId)?.name ?? ''"
        :dc="spellDC"
        :ranks="staffSpellsByRank"
        @open-spell="openSpellModal"
        @pick="pickSpellRoll"
      >
        <template #headerCounter>
          <CounterWidget
            class="relative -bottom-0.5 mt-px mr-2 h-4 text-sm"
            :value="staff?.charges?.value"
            :max="staff?.charges?.max"
            :title="inventory?.find((i) => i._id === staff?.staffId)?.name + ' charges'"
            editable
            @change-count="(newTotal) => staff?.setStaffCharges?.(newTotal)"
          />
        </template>
      </SpellSourceSection>
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
          <li v-for="item in sortedConsumables" class="flex justify-between px-4" :key="item._id">
            <div>
              <button
                type="button"
                v-if="item"
                @click="openSpellModal(item?._id, { isConsumable: true })"
                class="cursor-pointer text-left"
              >
                {{ item.name }}
              </button>
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
            <ModifierList :modifiers="viewedEntry.spellAttackModifiers" />
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
                :rollData="viewedConsumableSpellRollData"
                :itemId="viewedConsumable?._id ?? undefined"
              />
              <hr />
              <h4 class="pt-1 text-xl">{{ $t('spells.wandDetails') }}</h4>
            </div>
            <ParsedDescription
              ref="description"
              :text="viewedItem?.system.description?.value"
              :labels="rollOptionLabels"
              :rollData="viewedSpellRollData"
              :itemId="viewedItem?._id ?? undefined"
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
          <ModifierList
            v-if="viewedSpellRoll?.phase === 'attack' && viewedSpellRoll?.entry"
            :modifiers="viewedSpellRoll.entry.spellAttackModifiers"
          />
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
                i.system.location.value === spellSelectionModal?.options?.entryId &&
                (i.system.level.value ?? 0) <= spellSelectionModal?.options?.castingRank
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
