<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatModifier, SignedNumber } from '@/utils/utilities'
import type { Modifier } from '@/composables/character'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { storeToRefs } from 'pinia'
import { useListenersStore } from '@/stores/listenersOnline'
import InfoModal from './InfoModal.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import StrikeActionSet from './StrikeListActionSet.vue'
import type { Strike, ElementalBlast, Weapon } from '@/composables/character'
import type { DiceResults, RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'

import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import DropdownWidget from './widgets/DropdownWidget.vue'
import ActionIcons from './widgets/ActionIcons.vue'

import action1 from '@/assets/icons/action1.svg'
import action2 from '@/assets/icons/action2.svg'
import bludgeoning from '@/assets/icons/thor-hammer.svg'
import slashing from '@/assets/icons/battle-axe.svg'
import piercing from '@/assets/icons/arrowhead.svg'
import electricity from '@/assets/icons/electric.svg'
import fire from '@/assets/icons/celebration-fire.svg'
import cold from '@/assets/icons/snowflake-2.svg'
import vitality from '@/assets/icons/hearts.svg'
const damageIcons = { bludgeoning, slashing, piercing, electricity, fire, cold, vitality }
const actionIcons = { '1': action1, '2': action2 }

type ViewedTarget =
  | { kind: 'strike'; data: Strike; index: number; altUsage?: number }
  | { kind: 'blast'; data: ElementalBlast; index: number; isMelee: boolean }

interface Viewed {
  target: ViewedTarget
  phase: 'attack' | 'damage'
  subtype: number
}

interface EmitOptions {
  type: 'strike' | 'strike_damage' | 'blast' | 'blast_damage'
  subtype: number
}

const { t } = useI18n()
const character = useInjectedCharacter()
const { strikes, blasts, inventory, actions, blastActions, kineticAuraActive, toggleKineticAura } =
  character

const strikeModal = ref()
const strikeModalDamage = ref()
const viewed = ref<Viewed | undefined>()

// Modifier overrides for the current attack roll — same 3-state toggle
// pattern as StatBox. Reset when the modal closes.
const modifierOverrides = ref<Record<string, boolean>>({})

function toggleModifier(mod: Modifier) {
  const slug = mod.slug
  if (!slug) return
  const next = { ...modifierOverrides.value }
  if (slug in next) delete next[slug]
  else next[slug] = !mod.enabled
  modifierOverrides.value = next
}
function effectiveEnabled(mod: Modifier): boolean {
  const slug = mod.slug
  if (slug && slug in modifierOverrides.value) return modifierOverrides.value[slug]
  return !!mod.enabled
}
function isManuallyActivated(mod: Modifier): boolean {
  const slug = mod.slug
  return !!slug && slug in modifierOverrides.value && modifierOverrides.value[slug] === true && !mod.enabled
}
function isManuallyDeactivated(mod: Modifier): boolean {
  const slug = mod.slug
  return !!slug && slug in modifierOverrides.value && modifierOverrides.value[slug] === false && !!mod.enabled
}
// Simulate same-type stacking on the effective-enabled set.
const attackModifiers = computed(() =>
  viewed.value?.phase === 'attack' ? viewed.value?.target.data._modifiers ?? [] : []
)
const stackingLosers = computed<Set<string>>(() => {
  const losers = new Set<string>()
  const byType: Record<string, Modifier[]> = {}
  for (const m of attackModifiers.value) {
    if (!effectiveEnabled(m)) continue
    const type = m.type ?? 'untyped'
    if (type === 'untyped') continue
    ;(byType[type] ??= []).push(m)
  }
  for (const bucket of Object.values(byType)) {
    const pos = bucket.filter((m) => (m.modifier ?? 0) >= 0)
    const neg = bucket.filter((m) => (m.modifier ?? 0) < 0)
    const pick = (winners: Modifier[], better: (a: number, b: number) => boolean) => {
      if (winners.length <= 1) return
      let best = winners[0]
      for (let i = 1; i < winners.length; i++) {
        if (better(winners[i].modifier ?? 0, best.modifier ?? 0)) best = winners[i]
      }
      for (const m of winners) { if (m !== best && m.slug) losers.add(m.slug) }
    }
    pick(pos, (a, b) => a > b)
    pick(neg, (a, b) => a < b)
  }
  return losers
})
function isStackingLoser(mod: Modifier): boolean {
  return !!mod.slug && stackingLosers.value.has(mod.slug)
}

// Effective base total (MAP 0, no extra modifiers) with overrides applied.
const effectiveAttackBase = computed(() =>
  attackModifiers.value
    .filter((m) => effectiveEnabled(m) && !isStackingLoser(m))
    .reduce((sum, m) => sum + (m.modifier ?? 0), 0)
)

// Delta vs. the default MAP-0 total (parsed from the first variant's label).
// We compare to the parsed label rather than re-simulating default stacking,
// keeping the logic simple and consistent with what PF2e already computed.
const attackDelta = computed(() => {
  const v = viewed.value
  if (!v || v.phase !== 'attack' || !Object.keys(modifierOverrides.value).length) return 0
  const baseLabel = v.target.data.variants?.find((vrt) => vrt.map === 0)?.label ?? ''
  const m = baseLabel.match(/^([+-]?\d+)/)
  if (!m) return 0
  return effectiveAttackBase.value - parseInt(m[1], 10)
})

const { isListening } = storeToRefs(useListenersStore())

// A reloadable weapon that isn't loaded can't strike until it's reloaded.
const viewedNeedsReload = computed(
  () =>
    viewed.value?.target.kind === 'strike' &&
    !!viewed.value.target.data.reloadable &&
    !viewed.value.target.data.loaded
)

// builders for click handlers
function pickStrike(opts: EmitOptions, index: number, altUsage?: number) {
  const strike =
    altUsage === undefined ? strikes.value?.[index] : strikes.value?.[index]?.altUsages[altUsage]
  if (!strike) return
  viewed.value = {
    target: { kind: 'strike', data: strike, index, altUsage },
    phase: opts.type.endsWith('_damage') ? 'damage' : 'attack',
    subtype: opts.subtype
  }
  strikeModal.value.open()
}

function pickBlast(opts: EmitOptions, index: number, isMelee: boolean) {
  const blast = blasts.value?.[index]
  if (!blast) return
  viewed.value = {
    target: { kind: 'blast', data: blast, index, isMelee },
    phase: opts.type.endsWith('_damage') ? 'damage' : 'attack',
    subtype: opts.subtype
  }
  strikeModal.value.open()
}

// helpers
function blastDamageType(blast: ElementalBlast): string {
  return (
    blast.damageSelections?.[blast.blastElement ?? ''] ?? blast.blastDamageTypes?.[0]?.value ?? ''
  )
}

const attackTypeMap = new Map<boolean | undefined, 'melee' | 'ranged' | undefined>([
  [undefined, undefined],
  [true, 'melee'],
  [false, 'ranged']
])

// derived
const viewedItem = computed<Weapon | undefined>(() => {
  const itemId = viewed.value?.target.data.item?._id
  if (!itemId) return undefined
  return [...(inventory.value || []), ...(actions.value || [])].find((i) => i._id === itemId) as
    | Weapon
    | undefined
})

const viewedTraits = computed<string[]>(() => {
  const v = viewed.value
  if (!v) return []
  const base = (v.target.data.traits ?? [])
    .concat(v.target.data.weaponTraits ?? [])
    .map((t) => t.label ?? '')
  if (v.target.kind !== 'blast') return base
  const damageType = blastDamageType(v.target.data)
  const extraDamageTrait =
    damageType && !['bludgeoning', 'piercing', 'slashing'].includes(damageType) ? [damageType] : []
  return base.concat(viewedItem.value?.system?.traits?.value ?? []).concat(extraDamageTrait)
})

const viewedDamageTypeSelected = computed<string | undefined>(() => {
  const v = viewed.value
  if (!v) return undefined
  if (v.target.kind === 'blast') return blastDamageType(v.target.data)
  // Versatile's `selected` is a damage type string. Modular's `selected` is an
  // index into options — useless for the picker — so fall through to the
  // prepared damageType, which PF2e updates to mirror the current selection.
  return (
    viewedItem.value?.system?.traits?.toggles?.versatile?.selected ??
    viewedItem.value?.system?.damage?.damageType
  )
})

const damageTypeOptions = computed<string[]>(() => {
  const v = viewed.value
  if (!v) return []
  if (v.target.kind === 'blast') {
    return v.target.data.blastDamageTypes?.map((x) => x.value).filter((x): x is string => !!x) ?? []
  }
  const item = viewedItem.value
  if (!item) return []
  // For granted items, the source traits we serialize via toObject() may not
  // include the rune/feat-added trait — but the prepared strike's weaponTraits
  // does. Union both so we don't miss versatile/modular set by rule elements.
  const itemTraits = item.system?.traits?.value ?? []
  const strikeTraits = (v.target.data.weaponTraits ?? [])
    .map((t) => t.name)
    .filter((n): n is string => !!n)
  const traits = new Set<string>([...itemTraits, ...strikeTraits])
  // Modular weapons cycle through the three physical types regardless of which
  // is currently selected — the order is intrinsic to the weapon, not derived
  // from current state, so it stays put as the user picks.
  if (traits.has('modular')) return ['bludgeoning', 'piercing', 'slashing']
  // Versatile: base type first, then the alt offered by the trait.
  const types = new Set<string>()
  if (item.system?.damage?.damageType) types.add(item.system.damage.damageType)
  if (traits.has('versatile-b')) types.add('bludgeoning')
  if (traits.has('versatile-p')) types.add('piercing')
  if (traits.has('versatile-s')) types.add('slashing')
  return Array.from(types)
})

function doViewedAttack(diceResult?: number): Promise<RequestResolutionArgs | null> {
  const v = viewed.value
  if (!v) return Promise.resolve(null)
  const overrides = Object.keys(modifierOverrides.value).length ? { ...modifierOverrides.value } : undefined
  if (v.target.kind === 'blast') {
    const blast = v.target.data
    return (
      (blast.doStrike?.(
        v.subtype,
        undefined,
        {
          element: blast.blastElement,
          damageType: blastDamageType(blast),
          isMelee: v.target.isMelee
        },
        diceResult,
        overrides
      ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  }
  return (
    (v.target.data.doStrike?.(
      v.subtype,
      v.target.altUsage,
      undefined,
      diceResult,
      overrides
    ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
  )
}

function doViewedDamage(result?: DiceResults): Promise<RequestResolutionArgs | null> {
  const v = viewed.value
  if (!v) return Promise.resolve(null)
  if (v.target.kind === 'blast') {
    const blast = v.target.data
    return (
      (blast.doDamage?.(
        v.subtype,
        undefined,
        {
          element: blast.blastElement,
          damageType: blastDamageType(blast),
          isMelee: v.target.isMelee
        },
        result
      ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  }
  return (
    (v.target.data.doDamage?.(
      v.subtype,
      v.target.altUsage,
      undefined,
      result
    ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
  )
}

// The damage formula is fetched into strikeModalDamage when the modal opens
// in damage phase. Parse it into an ordered dice list so the Roll can declare
// what physical faces to expect — empty until the formula resolves, which
// keeps the d20 / single-die path unaffected.
const damageDice = computed<string[]>(() => {
  const v = viewed.value
  if (!v || v.phase !== 'damage') return []
  const formula = v.subtype
    ? strikeModalDamage.value?.response?.critical
    : strikeModalDamage.value?.response?.damage
  return parseDamageFormulaDice(formula)
})

function variantLabelForViewed(): string {
  const v = viewed.value
  if (!v) return ''
  return (
    v.target.data.variants?.find(
      (variant) =>
        variant.map === v.subtype &&
        variant.type ===
          (v.target.kind === 'blast' ? attackTypeMap.get(v.target.isMelee) : undefined)
    )?.label ?? ''
  )
}

const strikeRolls = computed<Roll[]>(() => {
  const v = viewed.value
  if (!v || !isListening.value) return []
  if (v.phase === 'attack') {
    const variantLabel = variantLabelForViewed()
    // When modifier overrides are active, adjust the numeric total in the
    // variant label by the computed delta so the roll button reflects the
    // actual value that will be sent.
    const delta = attackDelta.value
    const adjustedLabel = (() => {
      if (delta === 0) return variantLabel
      const match = variantLabel.match(/^([+-]?\d+)/)
      if (!match) return variantLabel
      return SignedNumber.format(parseInt(match[1], 10) + delta)
    })()
    const label = v.subtype === 0 ? `${t('strikes.strike')} ${adjustedLabel}` : adjustedLabel
    return [
      {
        key: 'strike-attack',
        label: label.trim(),
        color: 'blue',
        dice: ['d20'],
        disabled: viewedNeedsReload.value,
        armed: true,
        execute: (faces) => doViewedAttack(faces?.[0])
      }
    ]
  }
  const dice = damageDice.value
  return [
    {
      key: 'strike-damage',
      label: v.subtype ? t('strikes.critical') : t('strikes.damage'),
      color: 'red',
      disabled: viewedNeedsReload.value,
      dice: dice.length ? dice : undefined,
      // When physical faces are supplied (Pixel path), forward them as a
      // DiceResults payload; without faces the server rolls live.
      execute: (faces) =>
        doViewedDamage(faces && dice.length ? makeDiceResults(dice, faces) : undefined)
    }
  ]
})

function toggleLoaded() {
  const v = viewed.value
  if (!v || v.target.kind !== 'strike') return
  v.target.data.setLoaded?.(!v.target.data.loaded)
}

async function updateDamageFormula() {
  const v = viewed.value
  if (!v || !isListening.value) return
  if (v.target.kind === 'blast') {
    const blast = v.target.data
    strikeModalDamage.value = await blast.getDamage?.(undefined, {
      element: blast.blastElement,
      damageType: blastDamageType(blast),
      isMelee: v.target.isMelee
    })
  } else {
    strikeModalDamage.value = await v.target.data.getDamage?.(v.target.altUsage)
  }
}
watch(viewed, () => updateDamageFormula())

// The modal captures a snapshot of the opened strike/blast. When the character
// re-syncs (after changing ammo, reloading, etc.) the strikes/blasts arrays are
// rebuilt, so rebind the snapshot to the fresh object — otherwise the modal
// keeps showing stale state (e.g. the ammo dropdown snapping back).
watch([strikes, blasts], () => {
  const v = viewed.value
  if (!v) return
  if (v.target.kind === 'strike') {
    const fresh =
      v.target.altUsage === undefined
        ? strikes.value?.[v.target.index]
        : strikes.value?.[v.target.index]?.altUsages?.[v.target.altUsage]
    if (fresh) v.target.data = fresh
  } else {
    const fresh = blasts.value?.[v.target.index]
    if (fresh) v.target.data = fresh
  }
})
</script>
<template>
  <div data-component="StrikeList">
    <div class="break-inside-avoid py-4 [&:not(:has(li))]:hidden">
      <div data-section="blasts" class="break-inside-avoid [&:not(:has(li))]:hidden">
        <h3 class="text-lg underline">{{ $t('strikes.elementalBlastsHeading') }}</h3>
        <Button
          v-if="isListening"
          class="mt-1 mb-2"
          :color="kineticAuraActive ? 'lightgray' : 'blue'"
          :clicked="toggleKineticAura"
        >
          <ActionIcons
            v-if="!kineticAuraActive"
            actions="1"
            class="relative float-left mt-0.75 h-0 pr-2 text-lg leading-none"
          />
          {{ kineticAuraActive ? $t('strikes.deactivateAura') : $t('strikes.activateAura') }}
        </Button>
        <ul :class="{ 'pointer-events-none opacity-40': !kineticAuraActive }">
          <li v-for="(blast, i) in blasts" class="cursor-pointer pb-2" :key="blast.blastElement">
            <div v-for="attackType in ['melee', 'ranged']" :key="'at_' + attackType">
              <StrikeActionSet
                type="blast"
                :id="i"
                :isRanged="attackType === 'ranged'"
                :range="attackType === 'ranged' ? blast?.blastRange?.max : undefined"
                :label="$t('strikes.elementalBlastLabel', { element: blast.blastElement })"
                :mapLabelSet="blast?.variants.filter((v) => v.type === attackType)"
                @clicked="(_id, options) => pickBlast(options, i, attackType === 'melee')"
              />
            </div>
          </li>
        </ul>
      </div>
      <div
        data-section="strikes"
        class="break-inside-avoid [&:not(:has(li))]:hidden [div_&:not(.hidden)]:pt-2"
      >
        <h3 class="text-lg underline">{{ $t('strikes.strikesHeading') }}</h3>
        <ul>
          <li
            v-for="(strike, i) in strikes?.filter(
              (s) =>
                s?.visible !== false &&
                (s?.ready ||
                  s?.item?.system?.equipped?.carryType === 'held' ||
                  s?.item === undefined)
            )"
            class="cursor-pointer pb-2"
            :key="strike.slug"
          >
            <StrikeActionSet
              type="strike"
              :id="i"
              :label="strike?.label ?? strike?.item?.name"
              :isRanged="(strike?.item?.system?.range ?? 0) > 0"
              :range="strike?.item?.system?.range"
              :mapLabelSet="strike.variants"
              @clicked="(_id, options) => pickStrike(options, i)"
            />
            <div v-for="(altUsage, j) in strike?.altUsages" :key="strike.slug + '_alt_' + j">
              <StrikeActionSet
                type="strike"
                :id="i"
                :label="altUsage?.item?.name ?? altUsage?.label"
                :isRanged="(altUsage?.item?.system?.range ?? 0) > 0"
                :range="altUsage?.item?.system?.range"
                :mapLabelSet="altUsage?.variants"
                @clicked="(_id, options) => pickStrike(options, i, j)"
              />
            </div>
          </li>
        </ul>
      </div>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="strikeModal"
        :itemId="viewedItem?._id"
        :traits="viewedTraits"
        :rolls="strikeRolls"
        @closing="modifierOverrides = {}"
        :imageUrl="
          (viewed?.target.kind === 'blast' ? viewed.target.data.blastImg : undefined) ??
          viewedItem?.img ??
          'icons/skills/melee/unarmed-punch-fist.webp'
        "
      >
        <template #title>{{ viewed?.target.data.label }}</template>
        <template #description>{{
          viewed?.phase === 'damage' && viewed?.subtype === 1
            ? strikeModalDamage?.response?.critical
            : strikeModalDamage?.response?.damage
        }}</template>
        <div
          class="m-1 flex items-end gap-2"
          v-if="
            viewed?.target.kind === 'strike' &&
            (viewed.target.data.ammunition?.compatible?.length || viewed.target.data.reloadable)
          "
        >
          <DropdownWidget
            class="relative flex-1"
            :growContainer="true"
            :list="
              viewed.target.data.ammunition?.compatible?.length
                ? viewed.target.data.ammunition.compatible
                : [{ id: '', name: $t('strikes.noAmmo') }]
            "
            :selectedId="viewed.target.data.ammunition?.selected?.id ?? ''"
            :changed="
              (newId) => viewed?.target.kind === 'strike' && viewed.target.data.changeAmmo?.(newId)
            "
          />
          <Button
            v-if="isListening && viewed.target.data.reloadable"
            :color="viewed.target.data.loaded ? 'lightgray' : 'blue'"
            :disabled="!viewed.target.data.loaded && !viewed.target.data.ammunition?.selected?.id"
            :clicked="toggleLoaded"
            class="h-10 w-25"
          >
            <span v-if="viewed.target.data.loaded">{{ $t('strikes.unload') }}</span>
            <span v-else class="inline-flex items-center gap-1">
              <ActionIcons
                :actions="viewed.target.data.reloadActions ?? '1'"
                class="pf2-icon relative float-left -mt-2 h-0 text-lg leading-none"
              />
              {{ $t('strikes.reload') }}
            </span>
          </Button>
        </div>
        <div
          class="pb-2"
          v-if="
            viewed?.target.kind === 'blast'
              ? !viewed.target.isMelee && viewed.target.data.blastRange?.max
              : viewed?.target.data.item?.system?.range
          "
        >
          {{ $t('strikes.rangeLabel') }}
          {{
            viewed?.target.kind === 'blast'
              ? viewed.target.data.blastRange?.max
              : viewed?.target.data.item?.system?.range
          }}
          {{ $t('strikes.rangeUnit') }}
        </div>
        <div class="flex justify-end gap-2">
          <div v-if="damageTypeOptions.length > 1">
            <span class="mt-2">{{ $t('strikes.damageTypeLabel') }}</span>
            <ChoiceWidget
              :choiceSet="damageTypeOptions"
              :iconSet="damageIcons"
              :selected="viewedDamageTypeSelected ?? ''"
              :clicked="
                (damageType) =>
                  viewed?.target.data.setDamageType?.(damageType)?.then(() => updateDamageFormula())
              "
            />
          </div>
          <ChoiceWidget
            v-if="viewed?.target.kind === 'blast'"
            :choiceSet="['1', '2']"
            :iconSet="actionIcons"
            :selected="blastActions + ''"
            :clicked="(newChoice) => (blastActions = newChoice)"
          />
        </div>
        <!-- Strike attack/damage modifier breakdown. Same grid shape as the
             StatBox info modal (value | type tag | label). Attack-phase
             modifiers are toggleable (same 3-state system as StatBox);
             damage-phase modifiers are read-only. -->
        <ul class="mt-2">
          <li
            v-for="mod in viewed?.phase === 'damage'
              ? strikeModalDamage?.response?.modifiers
              : viewed?.target.data._modifiers"
            data-part="modifier"
            :data-disabled="
              viewed?.phase === 'attack'
                ? (!effectiveEnabled(mod) && !isManuallyActivated(mod) && !isManuallyDeactivated(mod)) || undefined
                : !mod.enabled || undefined
            "
            :data-manual-on="viewed?.phase === 'attack' && isManuallyActivated(mod) || undefined"
            :data-manual-off="viewed?.phase === 'attack' && isManuallyDeactivated(mod) || undefined"
            :data-stacking-loser="viewed?.phase === 'attack' && isStackingLoser(mod) || undefined"
            class="grid grid-cols-[2.5rem_6rem_1fr_auto] items-center gap-2 rounded-sm border border-transparent px-1 py-0.5"
            :class="{
              'cursor-pointer': viewed?.phase === 'attack',
              'text-gray-300':
                viewed?.phase === 'attack'
                  ? !effectiveEnabled(mod) && !isManuallyDeactivated(mod)
                  : !mod.enabled,
              'border-green-500 bg-green-100/40 dark:bg-green-900/30':
                viewed?.phase === 'attack' && isManuallyActivated(mod),
              'border-red-500 bg-red-100/40 text-red-700 line-through dark:bg-red-900/30 dark:text-red-300':
                viewed?.phase === 'attack' && isManuallyDeactivated(mod),
              'opacity-50 line-through': viewed?.phase === 'attack' && isStackingLoser(mod)
            }"
            :key="mod.slug"
            @click="viewed?.phase === 'attack' && toggleModifier(mod)"
          >
            <div class="text-right">
              <span v-if="mod.modifier !== undefined">{{ SignedNumber.format(mod.modifier) }}</span>
              <span v-if="mod.diceNumber">{{ `${mod.diceNumber}${mod.dieSize}` }}</span>
            </div>
            <div
              data-part="modifier-type"
              class="text-[0.65rem] tracking-wide uppercase opacity-60"
            >
              <template v-if="mod.type && mod.type !== 'untyped'">[{{ mod.type }}]</template>
            </div>
            <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
            <div v-if="mod.damageType" class="text-sm opacity-70">({{ mod.damageType }})</div>
          </li>
        </ul>
      </InfoModal>
    </Teleport>
  </div>
</template>
