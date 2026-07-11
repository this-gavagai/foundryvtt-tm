<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedActor } from '@/composables/injectKeys'
import { makeDiceResults, parseDamageFormulaDice } from '@/utils/diceFormula'
import InfoModal from '@/components/InfoModal.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import ChipToggle from '@/components/widgets/ChipToggle.vue'
import ModifierStepper from '@/components/widgets/ModifierStepper.vue'
import { dieIcons } from '@/utils/chatRollDisplay'
import type { Roll } from '@/types/roll-types'

// Shared faces-keyed icon map; die sizes here are 'd4'..'d12' strings.
function dieIcon(size: string): string {
  return dieIcons[Number(size.slice(1))]
}

const { t } = useI18n()
const { doDamage } = useInjectedActor()

const modalRef = ref()
const isSecret = ref(false)
const persistent = ref(false)
const precision = ref(false)
const splash = ref(false)
const activeType = ref<string>('untyped')

// A damage group is one PF2e DamageInstance, keyed by (damageType, persistent).
// `flat` is a typed flat bonus/penalty that lives inside the same tagged group,
// producing e.g. `(1d10+2d6+4)[electricity]` rather than a separate untyped pool
// member. Die chips and the flat modifier share the same IWR pass.
type DieSize = 'd4' | 'd6' | 'd8' | 'd10' | 'd12'
type DieCategory = null | 'precision' | 'splash'
interface DieChip {
  size: DieSize
  count: number
  category: DieCategory
}
interface DamageGroup {
  type: string
  persistent: boolean
  chips: DieChip[]
  flat: number
}
const groups = ref<DamageGroup[]>([])

function activeCategory(): DieCategory {
  if (precision.value) return 'precision'
  if (splash.value) return 'splash'
  return null
}
function groupMatches(g: DamageGroup) {
  return g.type === activeType.value && g.persistent === persistent.value
}
function chipMatches(c: DieChip, size: DieSize) {
  return c.size === size && c.category === activeCategory()
}
function groupHasTag(g: DamageGroup) {
  return g.type !== 'untyped' || g.persistent
}
function setPrecision(v: boolean) {
  precision.value = v
  if (v) splash.value = false
}
function setSplash(v: boolean) {
  splash.value = v
  if (v) precision.value = false
}

const DICE: DieChip['size'][] = ['d4', 'd6', 'd8', 'd10', 'd12']
const DAMAGE_TYPES = [
  'untyped',
  'bludgeoning',
  'piercing',
  'slashing',
  'acid',
  'cold',
  'electricity',
  'fire',
  'sonic',
  'force',
  'mental',
  'poison',
  'bleed',
  'vitality',
  'void',
  'spirit'
]

function getOrCreateGroup(): DamageGroup {
  let group = groups.value.find(groupMatches)
  if (!group) {
    group = { type: activeType.value, persistent: persistent.value, chips: [], flat: 0 }
    groups.value.push(group)
  }
  return group
}
function pruneGroup(group: DamageGroup) {
  if (group.chips.length === 0 && group.flat === 0) {
    const idx = groups.value.indexOf(group)
    if (idx !== -1) groups.value.splice(idx, 1)
  }
}

function addDie(size: DieSize) {
  const group = getOrCreateGroup()
  const chip = group.chips.find((c) => chipMatches(c, size))
  if (chip) chip.count++
  else group.chips.push({ size, count: 1, category: activeCategory() })
}
function removeChip(groupIdx: number, chipIdx: number) {
  const group = groups.value[groupIdx]
  if (!group) return
  group.chips.splice(chipIdx, 1)
  pruneGroup(group)
}
function addFlatModifier(step: number) {
  const group = getOrCreateGroup()
  group.flat += step
  pruneGroup(group)
}
function clearGroupFlat(group: DamageGroup) {
  group.flat = 0
  pruneGroup(group)
}
function clearAll() {
  groups.value = []
}

// The flat modifier for whichever group the current activeType/persistent
// settings point at — used to drive the step-button value display.
const currentGroupFlat = computed(() => groups.value.find(groupMatches)?.flat ?? 0)

// Mirror PF2e's formula.createPartialFormulas. The flat modifier is folded
// into the base (untagged) partition of each group so it shares the group's
// type tag: (1d10+2d6+4)[electricity], not (1d10+2d6)[electricity],4.
function buildPartition(chips: DieChip[], category: DieCategory): string {
  const members = chips.filter((c) => c.category === category)
  if (!members.length) return ''
  const terms = members.map((c) => `${c.count}${c.size}`)
  const sum = terms.join('+')
  if (!category) return sum
  const wrapped = terms.length > 1 ? `(${sum})` : sum
  return `${wrapped}[${category}]`
}

const formula = computed(() =>
  groups.value
    .filter((g) => g.chips.length > 0 || g.flat !== 0)
    .map((g) => {
      const dicePart = buildPartition(g.chips, null)
      // Combine base dice with the flat modifier (e.g. '1d8+4', '1d8-2', '4')
      const base = (() => {
        if (g.flat === 0) return dicePart
        const flatStr = g.flat > 0 ? `+${g.flat}` : `${g.flat}`
        return dicePart ? `${dicePart}${flatStr}` : `${g.flat}`
      })()
      const parts = [
        base,
        buildPartition(g.chips, 'precision'),
        buildPartition(g.chips, 'splash')
      ].filter(Boolean)
      const inner = parts.join('+')
      const tags: string[] = []
      if (g.type !== 'untyped') tags.push(g.type)
      if (g.persistent) tags.push('persistent')
      if (!tags.length) return inner
      const needsParens = /[+\-[]/.test(inner)
      return `${needsParens ? `(${inner})` : inner}[${tags.join(',')}]`
    })
    .join(',')
)

const damageRolls = computed<Roll[]>(() => {
  const f = formula.value
  const dice = f ? parseDamageFormulaDice(f) : []
  return [
    {
      key: 'damage-roll',
      label: t('sideMenu.rollDamage'),
      color: 'red',
      disabled: !f,
      dice: dice.length ? dice : undefined,
      execute: async (faces?: number[]) => {
        if (!f) return null
        const result = await doDamage(f, {
          secret: isSecret.value,
          diceResults: faces && dice.length ? makeDiceResults(dice, faces) : undefined
        })
        clearAll()
        return result
      }
    }
  ]
})

function open() {
  modalRef.value?.open()
}
function close() {
  modalRef.value?.close()
}

defineExpose({ open, close })
</script>
<template>
  <InfoModal ref="modalRef" :rolls="damageRolls">
    <template #title>{{ $t('sideMenu.damageRollTitle') }}</template>
    <template #bottomLeft>
      <Toggle :active="isSecret" @changed="(v: boolean) => (isSecret = v)">
        <span class="text-sm">{{ $t('sideMenu.secret') }}</span>
      </Toggle>
    </template>
    <template #beforeBody>
      <div data-component="DamageRollBuilder">
        <!-- Formula chips. Each typed group is wrapped in a capsule so it reads
           as a single unit. Untyped groups show bare chips without a capsule. -->
        <div
          data-part="damage-chips"
          class="mt-4 flex min-h-15 flex-wrap items-center gap-x-2 gap-y-1.5 rounded border border-gray-400 p-2"
        >
          <div
            v-for="(group, gi) in groups"
            :key="gi"
            data-part="damage-group"
            class="flex flex-wrap items-center gap-1"
            :class="
              groupHasTag(group) ? 'rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5' : ''
            "
          >
            <!-- Type label: plain text inside the capsule, not a separate chip -->
            <span
              v-if="groupHasTag(group)"
              data-part="damage-group-tag"
              class="pr-0.5 text-xs font-semibold capitalize select-none"
            >
              <span v-if="group.type !== 'untyped'">{{ group.type }}</span>
              <span v-if="group.persistent" :title="$t('sideMenu.persistent')">●</span>
            </span>
            <button
              v-for="(chip, ci) in group.chips"
              :key="ci + ':' + chip.size + ':' + chip.category"
              type="button"
              :title="$t('common.remove')"
              class="inline-flex cursor-pointer items-center gap-1 rounded border border-gray-400 bg-gray-100 px-2 py-1 text-sm whitespace-nowrap text-gray-900 select-none active:bg-gray-300"
              @click="removeChip(gi, ci)"
            >
              <span>{{ chip.count }}{{ chip.size }}</span>
              <span v-if="chip.category === 'precision'" :title="$t('sideMenu.precision')">◆</span>
              <span v-if="chip.category === 'splash'" :title="$t('sideMenu.splash')">✦</span>
            </button>
            <!-- Flat modifier chip -->
            <button
              v-if="group.flat !== 0"
              type="button"
              :title="$t('common.remove')"
              class="inline-flex cursor-pointer items-center rounded border border-gray-400 bg-gray-100 px-2 py-1 text-sm font-medium whitespace-nowrap text-gray-900 tabular-nums select-none active:bg-gray-300"
              @click="clearGroupFlat(group)"
            >
              {{ group.flat > 0 ? '+' + group.flat : group.flat }}
            </button>
          </div>
          <span v-if="!groups.length" class="text-sm text-gray-500 italic">
            {{ $t('sideMenu.damageEmpty') }}
          </span>
          <button
            v-if="groups.length"
            type="button"
            data-part="damage-clear-all"
            :title="$t('sideMenu.clear')"
            :aria-label="$t('sideMenu.clear')"
            class="ml-auto cursor-pointer px-1 text-xl leading-none text-gray-500 select-none hover:text-gray-800 active:text-gray-900"
            @click="clearAll"
          >
            ×
          </button>
        </div>

        <!-- Formula preview -->
        <div class="mt-1 min-h-4 font-mono text-xs text-gray-600">{{ formula || '&nbsp;' }}</div>

        <!-- Damage type tokens -->
        <div class="mt-4">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('sideMenu.damageType') }}
          </h4>
          <div data-part="damage-types" class="mt-1 flex flex-wrap gap-1">
            <ChipToggle
              v-for="dt in DAMAGE_TYPES"
              :key="dt"
              :active="activeType === dt"
              class="capitalize"
              @toggle="activeType = dt"
            >
              {{ dt }}
            </ChipToggle>
          </div>
        </div>

        <!-- Damage category toggles -->
        <div class="mt-3 flex flex-wrap items-center gap-4">
          <Toggle :active="persistent" @changed="(v: boolean) => (persistent = v)">
            <span class="text-sm">{{ $t('sideMenu.persistent') }}</span>
          </Toggle>
          <Toggle :active="precision" @changed="setPrecision">
            <span class="text-sm">{{ $t('sideMenu.precision') }}</span>
          </Toggle>
          <Toggle :active="splash" @changed="setSplash">
            <span class="text-sm">{{ $t('sideMenu.splash') }}</span>
          </Toggle>
        </div>

        <!-- Die buttons -->
        <div class="mt-4">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('sideMenu.addDie') }}
          </h4>
          <div data-part="damage-dice" class="mt-1 flex flex-wrap gap-1">
            <button
              v-for="d in DICE"
              :key="d"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded border border-gray-400 bg-gray-100 px-2 py-2 text-sm font-medium text-gray-900 select-none active:bg-gray-300"
              @click="addDie(d)"
            >
              <img :src="dieIcon(d)" alt="" aria-hidden="true" class="h-6 w-6" />
              <span>+{{ d }}</span>
            </button>
          </div>
        </div>

        <!-- Flat modifier buttons — always apply to the current active group -->
        <div class="mt-4">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('sideMenu.modifier') }}
          </h4>
          <ModifierStepper
            class="mt-1"
            :value="currentGroupFlat"
            @step="addFlatModifier"
            @clear="addFlatModifier(-currentGroupFlat)"
          />
        </div>
      </div>
    </template>
  </InfoModal>
</template>
