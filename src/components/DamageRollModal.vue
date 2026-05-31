<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { freeRoll } from '@/api/actions'
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
const { _id: characterId } = useInjectedCharacter()

const modalRef = ref()
const isSecret = ref(false)
const persistent = ref(false)
const precision = ref(false)
const splash = ref(false)
const activeType = ref<string>('untyped')

// One token per (size, type, persistent, precision, splash) tuple. Repeated
// additions of the same kind bump `count` instead of creating a second chip.
// persistent / precision / splash are PF2e's three unique damage categories
// (DAMAGE_CATEGORIES_UNIQUE) — they live as category tags in the flavor list.
interface DieChip {
  size: 'd4' | 'd6' | 'd8' | 'd10' | 'd12'
  type: string
  persistent: boolean
  precision: boolean
  splash: boolean
  count: number
}
const chips = ref<DieChip[]>([])

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

function addDie(size: DieChip['size']) {
  const existing = chips.value.find(
    (c) =>
      c.size === size &&
      c.type === activeType.value &&
      c.persistent === persistent.value &&
      c.precision === precision.value &&
      c.splash === splash.value
  )
  if (existing) existing.count++
  else
    chips.value.push({
      size,
      type: activeType.value,
      persistent: persistent.value,
      precision: precision.value,
      splash: splash.value,
      count: 1
    })
}
function removeChip(index: number) {
  chips.value.splice(index, 1)
}
function clearChips() {
  chips.value = []
}

// Each chip already represents Nd<size>[type,persistent]. Multi-chip formulas
// are joined with `,` (not `+`) because PF2e's DamageRoll grammar — `{ X , Y , Z }`
// — treats each comma-separated expression as a separate DamageInstance with
// its own type. Joining with `+` would collapse everything into one arithmetic
// expression and lose the per-term flavors, resulting in untyped damage.
const formula = computed(() =>
  chips.value
    .map((c) => {
      const tags: string[] = []
      if (c.type !== 'untyped') tags.push(c.type)
      if (c.persistent) tags.push('persistent')
      if (c.precision) tags.push('precision')
      if (c.splash) tags.push('splash')
      const base = `${c.count}${c.size}`
      return tags.length ? `${base}[${tags.join(',')}]` : base
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
        const result = await freeRoll(
          characterId.value ?? '',
          isSecret.value,
          undefined,
          f,
          faces && dice.length ? makeDiceResults(dice, faces) : undefined
        )
        // Reset the builder so the next open starts fresh.
        clearChips()
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
    <template #beforeBody>
      <div data-component="DamageRollBuilder">
      <div class="mt-2">
        <Toggle :active="isSecret" @changed="(v: boolean) => (isSecret = v)">
          <span class="text-lg">{{ $t('sideMenu.secret') }}</span>
        </Toggle>
      </div>

      <!-- Formula chips: tap to remove. The right-hand × clears everything. -->
      <div
        data-part="damage-chips"
        class="mt-4 flex min-h-12 flex-wrap items-center gap-1 rounded border border-gray-400 p-2"
      >
        <span
          v-for="(chip, i) in chips"
          :key="
            i +
            ':' +
            chip.size +
            ':' +
            chip.type +
            ':' +
            chip.persistent +
            ':' +
            chip.precision +
            ':' +
            chip.splash
          "
          class="inline-flex cursor-pointer items-center gap-1 rounded border border-gray-400 bg-gray-100 px-2 py-1 text-sm whitespace-nowrap text-gray-900 select-none active:bg-gray-300"
          @click="removeChip(i)"
        >
          <span>{{ chip.count }}{{ chip.size }}</span>
          <span v-if="chip.type !== 'untyped'" class="capitalize">{{ chip.type }}</span>
          <span v-if="chip.persistent" :title="$t('sideMenu.persistent')">●</span>
          <span v-if="chip.precision" :title="$t('sideMenu.precision')">◆</span>
          <span v-if="chip.splash" :title="$t('sideMenu.splash')">✦</span>
        </span>
        <span v-if="!chips.length" class="text-sm text-gray-500 italic">
          {{ $t('sideMenu.damageEmpty') }}
        </span>
        <span
          v-if="chips.length"
          :title="$t('sideMenu.clear')"
          class="ml-auto cursor-pointer px-1 text-lg leading-none text-gray-500 select-none hover:text-gray-800 active:text-gray-900"
          @click="clearChips"
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

      <!-- Damage category toggles: apply to subsequently added dice -->
      <div class="mt-3 flex flex-wrap items-center gap-4">
        <Toggle :active="persistent" @changed="(v: boolean) => (persistent = v)">
          <span class="text-sm">{{ $t('sideMenu.persistent') }}</span>
        </Toggle>
        <Toggle :active="precision" @changed="(v: boolean) => (precision = v)">
          <span class="text-sm">{{ $t('sideMenu.precision') }}</span>
        </Toggle>
        <Toggle :active="splash" @changed="(v: boolean) => (splash = v)">
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
