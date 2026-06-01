<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { makeDiceResults, parseDamageFormulaDice } from '@/utils/diceFormula'
import InfoModal from '@/components/InfoModal.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import type { Roll } from '@/types/roll-types'

import d4Icon from '@/assets/icons/d4.svg'
import d6Icon from '@/assets/icons/d6.svg'
import d8Icon from '@/assets/icons/d8.svg'
import d10Icon from '@/assets/icons/d10.svg'
import d12Icon from '@/assets/icons/d12.svg'

const dieIcons: Record<string, string> = {
  d4: d4Icon,
  d6: d6Icon,
  d8: d8Icon,
  d10: d10Icon,
  d12: d12Icon
}

const { t } = useI18n()
const { doDamage } = useInjectedCharacter()

const modalRef = ref()
const isSecret = ref(false)
const persistent = ref(false)
const precision = ref(false)
const splash = ref(false)
const activeType = ref<string>('untyped')

// A damage group is one PF2e DamageInstance. Per the Remaster damage rules and
// pf2e/src/module/system/damage/formula.ts, an instance is keyed by
// (damageType, persistent) — multiple same-type dice (including precision and
// splash) are merged into one instance so IWR applies once. Precision and
// splash live *inside* an instance as per-die flavor tags ([precision], [splash])
// that PF2e isolates at IWR time via componentTotal("precision"). Only
// persistent damage gets its own instance — it has separate timing (end of turn)
// and a `persistent` flavor at the instance level.
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
// Precision and splash are PF2e's DAMAGE_CATEGORIES_UNIQUE — a die can carry at
// most one. Enforce mutual exclusion on the toggles so the active state always
// maps to a single DieCategory.
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

function addDie(size: DieSize) {
  let group = groups.value.find(groupMatches)
  if (!group) {
    group = {
      type: activeType.value,
      persistent: persistent.value,
      chips: []
    }
    groups.value.push(group)
  }
  const chip = group.chips.find((c) => chipMatches(c, size))
  if (chip) chip.count++
  else group.chips.push({ size, count: 1, category: activeCategory() })
}
function removeChip(groupIdx: number, chipIdx: number) {
  const group = groups.value[groupIdx]
  if (!group) return
  group.chips.splice(chipIdx, 1)
  if (!group.chips.length) groups.value.splice(groupIdx, 1)
}
function clearAll() {
  groups.value = []
}

// Mirror PF2e's formula.createPartialFormulas: within an instance, dice are
// partitioned by per-die category. Base dice (null) sum plain; precision/splash
// partitions get parenthesized and tagged with their category flavor. The whole
// instance then gets the [type,persistent?] flavor at the outer bracket. Groups
// (= instances) are joined with `,`; DamageRoll auto-wraps the result in `{...}`.
//   base 1d8 slashing + precision 2d6 → (1d8+(2d6)[precision])[slashing]
//   fire 1d6 + persistent fire 1d4    → 1d6[fire],(1d4)[persistent,fire]
function buildPartition(chips: DieChip[], category: DieCategory): string {
  const members = chips.filter((c) => c.category === category)
  if (!members.length) return ''
  const terms = members.map((c) => `${c.count}${c.size}`)
  const sum = terms.join('+')
  if (!category) return sum
  // Precision / splash flavor binds to the whole partition; PF2e wraps in
  // parens when the inner sum has operators (formula.ts:275-283).
  const wrapped = terms.length > 1 ? `(${sum})` : sum
  return `${wrapped}[${category}]`
}
const formula = computed(() =>
  groups.value
    .filter((g) => g.chips.length)
    .map((g) => {
      const parts = [
        buildPartition(g.chips, null),
        buildPartition(g.chips, 'precision'),
        buildPartition(g.chips, 'splash')
      ].filter(Boolean)
      const inner = parts.join('+')
      const tags: string[] = []
      if (g.type !== 'untyped') tags.push(g.type)
      if (g.persistent) tags.push('persistent')
      if (!tags.length) return inner
      // The instance flavor binds to the whole inner expression. Wrap in parens
      // whenever inner contains an operator (a sum) or already carries a flavor
      // bracket — you can't stack `X[a][b]` directly, PF2e wraps the same way
      // (formula.ts:270-272: `term.endsWith("]") ? `(${term})[${category}]` …`).
      const needsParens = /[+\-[]/.test(inner)
      return `${needsParens ? `(${inner})` : inner}[${tags.join(',')}]`
    })
    .join(',')
)

const damageRolls = computed<Roll[]>(() => {
  const f = formula.value
  const dice = f ? parseDamageFormulaDice(f) : []
  // Always emit one Roll so the button is rendered with stable height;
  // disable it when there's no formula yet (no dice added) so the contents
  // don't reflow on the first chip add.
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
        // Reset the builder so the next open starts fresh.
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
      <!-- Formula chips: dice tap-to-remove. Groups (one per DamageInstance)
           are formed automatically by matching (type, category) — a new group
           appears when the active type/category combo doesn't match any
           existing group. The right-hand × clears everything. -->
      <div
        data-part="damage-chips"
        class="mt-4 flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded border border-gray-400 p-2"
      >
        <div
          v-for="(group, gi) in groups"
          :key="gi"
          data-part="damage-group"
          class="flex flex-wrap items-center gap-1"
        >
          <span
            v-if="groupHasTag(group)"
            data-part="damage-group-tag"
            class="inline-flex items-center gap-1 rounded border border-gray-500 bg-gray-200 px-2 py-1 text-xs whitespace-nowrap text-gray-900 capitalize select-none"
          >
            <span v-if="group.type !== 'untyped'">{{ group.type }}</span>
            <span v-if="group.persistent" :title="$t('sideMenu.persistent')">●</span>
          </span>
          <span
            v-for="(chip, ci) in group.chips"
            :key="ci + ':' + chip.size + ':' + chip.category"
            class="inline-flex cursor-pointer items-center gap-1 rounded border border-gray-400 bg-gray-100 px-2 py-1 text-sm whitespace-nowrap text-gray-900 select-none active:bg-gray-300"
            @click="removeChip(gi, ci)"
          >
            <span>{{ chip.count }}{{ chip.size }}</span>
            <span v-if="chip.category === 'precision'" :title="$t('sideMenu.precision')">◆</span>
            <span v-if="chip.category === 'splash'" :title="$t('sideMenu.splash')">✦</span>
          </span>
        </div>
        <span v-if="!groups.length" class="text-sm text-gray-500 italic">
          {{ $t('sideMenu.damageEmpty') }}
        </span>
        <span
          v-if="groups.length"
          :title="$t('sideMenu.clear')"
          class="ml-auto cursor-pointer px-1 text-lg leading-none text-gray-500 select-none hover:text-gray-800 active:text-gray-900"
          @click="clearAll"
        >
          ×
        </span>
      </div>

      <!-- Resolved formula preview. Always rendered (even when empty) so the
           layout below doesn't shift when the first chip lands. -->
      <div class="mt-1 min-h-4 font-mono text-xs text-gray-600">{{ formula || ' ' }}</div>

      <!-- Damage type tokens: tap to select active type -->
      <div class="mt-4">
        <h4 class="text-xs tracking-wide text-gray-600 uppercase">
          {{ $t('sideMenu.damageType') }}
        </h4>
        <div data-part="damage-types" class="mt-1 flex flex-wrap gap-1">
          <span
            v-for="dt in DAMAGE_TYPES"
            :key="dt"
            :data-active="activeType === dt ? '' : undefined"
            class="inline-block cursor-pointer rounded border border-gray-400 bg-gray-100 px-2 py-1 text-xs whitespace-nowrap text-gray-900 capitalize select-none active:bg-gray-300 data-active:border-blue-700 data-active:bg-blue-600 data-active:text-white"
            @click="activeType = dt"
          >
            {{ dt }}
          </span>
        </div>
      </div>

      <!-- Damage category toggles: apply to subsequently added dice. Persistent
           is an instance-level flag (separates into its own DamageInstance) so
           it can combine with precision or splash. Precision and splash are
           per-die categories and mutually exclusive (DAMAGE_CATEGORIES_UNIQUE
           in pf2e/src/module/system/damage/values.ts). -->
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

      <!-- Die buttons: tap to add a chip with the current type/persistent -->
      <div class="mt-4">
        <h4 class="text-xs tracking-wide text-gray-600 uppercase">
          {{ $t('sideMenu.addDie') }}
        </h4>
        <div data-part="damage-dice" class="mt-1 flex flex-wrap gap-1">
          <span
            v-for="d in DICE"
            :key="d"
            class="inline-flex cursor-pointer items-center gap-1 rounded border border-gray-400 bg-gray-100 px-2 py-2 text-sm font-medium text-gray-900 select-none active:bg-gray-300"
            @click="addDie(d)"
          >
            <img :src="dieIcons[d]" :alt="d" class="h-6 w-6" />
            <span>+{{ d }}</span>
          </span>
        </div>
      </div>
      </div>
    </template>
  </InfoModal>
</template>
