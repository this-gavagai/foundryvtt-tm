<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { InventoryItem } from '@/composables/character'
import type { TablemateCharacter } from '@/types/character-types'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { useCoins } from '@/composables/useCoins'
import {
  COIN_DENOMINATIONS,
  addCounts,
  copperValue,
  emptyCounts,
  formatGold,
  hasChange,
  signedGold,
  type CoinCounts,
  type Denomination
} from '@/utils/coins'

import Modal from '@/components/ModalBox.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import EquipmentCoinRow from '@/components/EquipmentCoinRow.vue'

// The purse: coins pulled out of the inventory list and given their own panel.
//
// Coins are fungible, so the item-shaped treatment the rest of the inventory
// gets is all wrong for them — a description is pointless, and a quantity modal
// that steps by one is worse than pointless when a player is splitting 340 gp
// of loot four ways. This panel reads the four counts at a glance and opens an
// editor built for what anyone actually does with money: change it, in whatever
// size the change happens to be.
//
// One row of controls serves both, differing only in whose coins they are
// pointed at: the character's own, or the party's outright — loot dropped
// straight into the pot, without it passing through anyone's pocket.
//
// The transfer checkbox turns the same edit into a move: the coins the draft
// adds come out of the other purse instead of thin air, and the ones it removes
// land there instead of nowhere. Transferring is a property of a change, not a
// different way of making one, so it rides along with the controls rather than
// taking a mode of its own.
// Nothing is written until Apply, so a hundred taps — or one held button, or a
// typed number — still costs at most four writes per purse.
// Which purse the rows are pointed at. Labels rather than icons: the sheet
// already spends the meeple/meeple-group pair on the inventory toggle directly
// above this panel, and a second copy of it would read as the same control.
type Purse = 'character' | 'party'
const PURSES: Purse[] = ['character', 'party']

const props = defineProps<{
  // The party bits come from EquipmentList's usePartyTransfer rather than a
  // second instance: that composable opens a socket listener on the party
  // actor, and two of them would double every party update.
  partyActorId?: string | null
  partyActor?: TablemateCharacter
  partyInventory?: InventoryItem[]
  // Which inventory this instance sits under. The bar shows that purse's coins
  // and the editor opens on it; the editor itself can still reach either.
  panel?: Purse
}>()

const { t } = useI18n()
const character = useInjectedCharacter()
const { inventory, _id, _actor } = character

const coinModal = ref<InstanceType<typeof Modal>>()

const { counts: characterCounts, applyDeltas: applyToCharacter } = useCoins({
  actorId: _id,
  actor: _actor,
  inventory
})

const { counts: partyCounts, applyDeltas: applyToParty } = useCoins({
  actorId: computed(() => props.partyActorId),
  actor: computed(() => props.partyActor),
  inventory: computed(() => props.partyInventory)
})

// Coarse steps matter more than fine ones here: a purse changes by a hundred
// gold far more often than a UI usually changes by anything, and a thousand is
// one platinum's worth of copper.
const STEPS = ['1', '10', '100', '1000']
const step = ref('1')

const mode = ref<Purse>('character')
const inParty = computed(() => !!props.partyActorId)

// The purse this instance's bar reads.
const barPurse = computed<Purse>(() => props.panel ?? 'character')
const barCounts = computed(() =>
  barPurse.value === 'party' ? partyCounts.value : characterCounts.value
)

const deltas = ref<CoinCounts>(emptyCounts())
const dirty = computed(() => hasChange(deltas.value))

// Whether the draft comes out of (and goes into) the other purse.
const transfer = ref(false)

function negated(counts: Partial<CoinCounts>): CoinCounts {
  const out = emptyCounts()
  for (const d of COIN_DENOMINATIONS) out[d] = -(counts[d] ?? 0)
  return out
}

function reset() {
  deltas.value = emptyCounts()
}

// A draft means "+5 gp into my pocket" in one mode and "+5 gp into the party
// pot" in the other, so it can't survive the switch. Leaving a party drops the
// party mode with it.
watch([mode, inParty], () => {
  if (!inParty.value) mode.value = 'character'
  reset()
})

// The purse the rows read and write, and the one a transfer moves against.
const subject = computed(() =>
  mode.value === 'party' ? partyCounts.value : characterCounts.value
)
const counterpart = computed(() =>
  mode.value === 'party' ? characterCounts.value : partyCounts.value
)
// What each purse ends up holding. A purse the draft doesn't touch previews as
// what it already has: only the one in view moves, unless a transfer is pulling
// the same coins the other way.
const characterDelta = computed(() =>
  mode.value === 'character'
    ? deltas.value
    : transfer.value
      ? negated(deltas.value)
      : emptyCounts()
)
const partyDelta = computed(() =>
  mode.value === 'party' ? deltas.value : transfer.value ? negated(deltas.value) : emptyCounts()
)
const characterPreview = computed(() => addCounts(characterCounts.value, characterDelta.value))
const partyPreview = computed(() => addCounts(partyCounts.value, partyDelta.value))

const characterChange = computed(() => copperValue(characterDelta.value))
const partyChange = computed(() => copperValue(partyDelta.value))

const subjectPreview = computed(() =>
  mode.value === 'party' ? partyPreview.value : characterPreview.value
)
const counterpartPreview = computed(() =>
  mode.value === 'party' ? characterPreview.value : partyPreview.value
)

// A purse can't end up owing coins, so a held-down minus stops at zero. Adding
// is bounded by nothing — unless the coins have to come from somewhere, in
// which case the other purse is the ceiling.
function clamp(denomination: Denomination, wanted: number) {
  const floor = -subject.value[denomination]
  const ceiling = transfer.value ? counterpart.value[denomination] : Number.MAX_SAFE_INTEGER
  return Math.min(ceiling, Math.max(floor, wanted))
}

// Ticking the box mid-draft can leave more drafted than the other purse holds,
// so the draft is brought back inside the new bounds rather than failing later.
watch(transfer, () => {
  const next = { ...deltas.value }
  for (const d of COIN_DENOMINATIONS) next[d] = clamp(d, next[d])
  deltas.value = next
})

function stepBy(denomination: Denomination, direction: 1 | -1) {
  deltas.value = {
    ...deltas.value,
    [denomination]: clamp(denomination, deltas.value[denomination] + direction * Number(step.value))
  }
}

function setCount(denomination: Denomination, value: number) {
  deltas.value = {
    ...deltas.value,
    [denomination]: clamp(denomination, value - subject.value[denomination])
  }
}

function canDecrease(denomination: Denomination) {
  return subjectPreview.value[denomination] > 0
}
function canIncrease(denomination: Denomination) {
  return !transfer.value || counterpartPreview.value[denomination] > 0
}

// "Transfer to Party", "from Party", or "to/from Party" — the preposition
// follows what the draft does, the purse is whichever one isn't in view. An
// empty draft reads as the neutral both.
const transferLabel = computed(() => {
  const purse = mode.value === 'party' ? t('coins.modeCharacter') : t('coins.modeParty')
  const adds = COIN_DENOMINATIONS.some((d) => deltas.value[d] > 0)
  const removes = COIN_DENOMINATIONS.some((d) => deltas.value[d] < 0)
  if (adds && !removes) return t('coins.transferFrom', { purse })
  if (removes && !adds) return t('coins.transferTo', { purse })
  return t('coins.transferBoth', { purse })
})

async function apply() {
  if (!dirty.value) return
  const draft = deltas.value
  // The modifiers go the moment Apply is pressed and the counts show what was
  // written; useCoins holds those counts until the actor data agrees, and drops
  // any that fail back to what the actor holds. The draft is not handed back on
  // failure: writes settle per denomination, so re-applying a whole draft over
  // a partly-written one would double what did land. What failed is visible in
  // the counts instead.
  reset()

  const applyToSubject = mode.value === 'party' ? applyToParty : applyToCharacter
  if (!transfer.value) {
    await applyToSubject(draft)
    return
  }

  // A move is the same draft, negated, against the other purse. Both sides'
  // additions land before either side's removals, so a write that fails partway
  // leaves coins duplicated at worst rather than destroyed.
  const applyToCounterpart = mode.value === 'party' ? applyToCharacter : applyToParty
  const gains = emptyCounts()
  const losses = emptyCounts()
  for (const d of COIN_DENOMINATIONS) {
    if (draft[d] > 0) gains[d] = draft[d]
    else if (draft[d] < 0) losses[d] = draft[d]
  }
  await Promise.all([applyToSubject(gains), applyToCounterpart(negated(losses))])
  await Promise.all([applyToSubject(losses), applyToCounterpart(negated(gains))])
}

function openEditor() {
  reset()
  transfer.value = false
  mode.value = barPurse.value
  coinModal.value?.open()
}
</script>

<template>
  <div data-component="EquipmentCoins">
    <button
      type="button"
      data-part="purse"
      class="flex w-full cursor-pointer items-center gap-1 px-2"
      :aria-label="$t('coins.title')"
      @click="openEditor"
    >
      <span
        v-for="denomination in COIN_DENOMINATIONS"
        :key="denomination"
        data-part="purse-coin"
        :data-denomination="denomination"
        :data-empty="barCounts[denomination] === 0 ? 'true' : 'false'"
        class="flex flex-1 items-baseline justify-center gap-1"
      >
        <span data-part="coin-dot" aria-hidden="true" />
        <span data-part="coin-amount">{{ barCounts[denomination] }}</span>
        <span data-part="coin-unit">{{ $t(`coins.denominations.${denomination}`) }}</span>
      </span>
      <span data-part="purse-total">{{ formatGold(copperValue(barCounts)) }}</span>
    </button>

    <Teleport to="#modals">
      <Modal ref="coinModal" :title="$t('coins.title')">
        <div data-component="EquipmentCoinEditor">
          <ChoiceWidget
            v-if="inParty"
            class="mt-3 w-full"
            :choiceSet="PURSES"
            :labelSet="{ character: $t('coins.modeCharacter'), party: $t('coins.modeParty') }"
            :selected="mode"
            @changed="(value: string) => (mode = value as Purse)"
          />

          <div data-part="step-picker" class="mt-2 flex items-center gap-3">
            <span data-part="step-label">{{ $t('coins.stepLabel') }}</span>
            <ChoiceWidget
              class="mb-0 flex-1"
              :choiceSet="STEPS"
              :labelSet="{ '1': '±1', '10': '±10', '100': '±100', '1000': '±1000' }"
              :selected="step"
              size="sm"
              @changed="(value: string) => (step = value)"
            />
          </div>

          <ul data-part="coin-rows">
            <EquipmentCoinRow
              v-for="denomination in COIN_DENOMINATIONS"
              :key="denomination"
              :denomination="denomination"
              :value="subject[denomination]"
              :delta="deltas[denomination]"
              :canIncrease="canIncrease(denomination)"
              :canDecrease="canDecrease(denomination)"
              @step="(direction) => stepBy(denomination, direction)"
              @set="(value) => setCount(denomination, value)"
            />
          </ul>

          <!-- Both purses, always: which one a change lands in is the thing
               most worth being sure of, and a transfer moves both at once. -->
          <dl data-part="coin-totals">
            <div data-part="total-row">
              <dt>{{ $t('coins.modeCharacter') }}</dt>
              <dd>
                <span
                  data-part="coin-change"
                  v-if="characterChange !== 0"
                  :data-sign="characterChange > 0 ? 'up' : 'down'"
                  >{{ signedGold(characterChange) }}</span
                >
                <span data-part="coin-total">{{ formatGold(copperValue(characterPreview)) }}</span>
              </dd>
            </div>
            <div data-part="total-row" v-if="inParty">
              <dt>{{ $t('coins.modeParty') }}</dt>
              <dd>
                <span
                  data-part="coin-change"
                  v-if="partyChange !== 0"
                  :data-sign="partyChange > 0 ? 'up' : 'down'"
                  >{{ signedGold(partyChange) }}</span
                >
                <span data-part="coin-total">{{ formatGold(copperValue(partyPreview)) }}</span>
              </dd>
            </div>
          </dl>

          <label v-if="inParty" data-part="transfer-toggle">
            <input
              type="checkbox"
              :checked="transfer"
              @change="transfer = ($event.target as HTMLInputElement).checked"
            />
            <span>{{ transferLabel }}</span>
          </label>

          <div data-part="coin-actions" class="mt-4 flex justify-end gap-2">
            <Button color="lightgray" :disabled="!dirty" :clicked="reset">
              {{ $t('coins.reset') }}
            </Button>
            <Button color="green" :disabled="!dirty" :clicked="apply">
              {{ $t('coins.apply') }}
            </Button>
          </div>
        </div>
      </Modal>
    </Teleport>
  </div>
</template>
