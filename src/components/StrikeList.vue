<script setup lang="ts">
import { inject, ref, watch, computed } from 'vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import { useListeners } from '@/composables/listenersOnline'
import InfoModal from './InfoModal.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import StrikeActionSet from './StrikeListActionSet.vue'
import type { Strike, ElementalBlast, Weapon } from '@/composables/character'
import type { RequestResolutionArgs } from '@/types/api-types'

import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import DropdownWidget from './widgets/DropdownWidget.vue'

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

const character = inject(useKeys().characterKey)!
const { strikes, blasts, inventory, actions, blastActions } = character

const strikeModal = ref()
const strikeModalDamage = ref()
const viewed = ref<Viewed | undefined>()

const { isListening } = useListeners()

// builders for click handlers
function pickStrike(opts: EmitOptions, index: number, altUsage?: number) {
  const strike = altUsage === undefined ? strikes.value?.[index] : strikes.value?.[index]?.altUsages[altUsage]
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
    blast.damageSelections?.[blast.blastElement ?? ''] ??
    blast.blastDamageTypes?.[0]?.value ??
    ''
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
  return [...(inventory.value || []), ...(actions.value || [])].find(
    (i) => i._id === itemId
  ) as Weapon | undefined
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
  return (
    viewedItem.value?.system?.traits?.toggles?.modular?.selected ??
    viewedItem.value?.system?.traits?.toggles?.versatile?.selected ??
    viewedItem.value?.system?.damage?.damageType
  )
})

const damageTypeOptions = computed<string[]>(() => {
  const v = viewed.value
  if (!v) return []
  if (v.target.kind === 'blast') {
    return (v.target.data.blastDamageTypes?.map((x) => x.value).filter((x): x is string => !!x)) ?? []
  }
  const item = viewedItem.value
  if (!item) return []
  const types = new Set<string>()
  if (item.system?.damage?.damageType) types.add(item.system.damage.damageType)
  const traits = item.system?.traits?.value ?? []
  if (traits.includes('versatile-b')) types.add('bludgeoning')
  if (traits.includes('versatile-p')) types.add('piercing')
  if (traits.includes('versatile-s')) types.add('slashing')
  if (traits.includes('modular')) ['slashing', 'piercing', 'bludgeoning'].forEach((t) => types.add(t))
  return Array.from(types)
})

function doViewedAttack(diceResult?: number): Promise<RequestResolutionArgs | null> {
  const v = viewed.value
  if (!v) return Promise.resolve(null)
  if (v.target.kind === 'blast') {
    const blast = v.target.data
    return (
      (blast.doStrike?.(
        v.subtype,
        undefined,
        { element: blast.blastElement, damageType: blastDamageType(blast), isMelee: v.target.isMelee },
        diceResult
      ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  }
  return (
    (v.target.data.doStrike?.(
      v.subtype,
      v.target.altUsage,
      undefined,
      diceResult
    ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
  )
}

function doViewedDamage(): Promise<RequestResolutionArgs | null> {
  const v = viewed.value
  if (!v) return Promise.resolve(null)
  if (v.target.kind === 'blast') {
    const blast = v.target.data
    return (
      (blast.doDamage?.(v.subtype, undefined, {
        element: blast.blastElement,
        damageType: blastDamageType(blast),
        isMelee: v.target.isMelee
      }) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  }
  return (
    (v.target.data.doDamage?.(v.subtype, v.target.altUsage) as Promise<RequestResolutionArgs>) ??
    Promise.resolve(null)
  )
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
</script>
<template>
  <div>
    <div class="break-inside-avoid px-6 py-4 [&:not(:has(li))]:hidden">
      <div class="break-inside-avoid [&:not(:has(li))]:hidden">
        <h3 class="text-lg underline">Elemental Blasts</h3>
        <ul>
          <li v-for="(blast, i) in blasts" class="cursor-pointer pb-2" :key="blast.blastElement">
            <div v-for="attackType in ['melee', 'ranged']" :key="'at_' + attackType">
              <StrikeActionSet
                type="blast"
                :id="i"
                :isRanged="attackType === 'ranged'"
                :range="attackType === 'ranged' ? blast?.blastRange?.max : undefined"
                :label="`Elemental Blast (${blast.blastElement})`"
                :mapLabelSet="blast?.variants.filter((v) => v.type === attackType)"
                @clicked="(_id, options) => pickBlast(options, i, attackType === 'melee')"
              />
            </div>
          </li>
        </ul>
      </div>
      <div class="break-inside-avoid [&:not(:has(li))]:hidden [div_&:not(.hidden)]:pt-2">
        <h3 class="text-lg underline">Strikes</h3>
        <ul>
          <li
            v-for="(strike, i) in strikes?.filter(
              (s) => s?.item?.system?.equipped?.carryType === 'held' || s?.item === undefined
            )"
            class="cursor-pointer pb-2"
            :key="strike.slug"
          >
            <StrikeActionSet
              type="strike"
              :id="i"
              :label="strike?.label ?? strike?.item?.name"
              :isRanged="strike?.item?.system?.range ?? NaN > 0"
              :range="strike?.item?.system?.range"
              :mapLabelSet="strike.variants"
              @clicked="(_id, options) => pickStrike(options, i)"
            />
            <div v-for="(altUsage, j) in strike?.altUsages" :key="strike.slug + '_alt_' + j">
              <StrikeActionSet
                type="strike"
                :id="i"
                :label="altUsage?.item?.name ?? altUsage?.label"
                :isRanged="altUsage?.item?.system?.range ?? NaN > 0"
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
        :diceRequest="viewed?.phase === 'attack' ? ['d20'] : undefined"
        @diceResult="
          (diceResult: number | undefined) =>
            doViewedAttack(diceResult)?.then((r) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
        "
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
        <div class="m-1">
          <DropdownWidget
            class="relative"
            :growContainer="true"
            v-if="viewed?.target.kind === 'strike' && viewed.target.data.ammunition?.compatible?.length"
            :list="
              [{ id: '', name: 'No ammo' }].concat(viewed.target.data.ammunition?.compatible ?? [])
            "
            :selectedId="viewed.target.data.ammunition?.selected?.id ?? ''"
            :changed="(newId) => viewed?.target.kind === 'strike' && viewed.target.data.changeAmmo?.(newId)"
          />
        </div>
        <div
          class="pb-2"
          v-if="
            (viewed?.target.kind === 'blast'
              ? viewed.target.data.blastRange?.max
              : viewed?.target.data.item?.system?.range)
          "
        >
          Range:
          {{
            viewed?.target.kind === 'blast' && viewed.target.isMelee
              ? undefined
              : viewed?.target.kind === 'blast'
                ? viewed.target.data.blastRange?.max
                : viewed?.target.data.item?.system?.range
          }}
          ft.
        </div>
        <div class="flex justify-end gap-2">
          <div v-if="damageTypeOptions.length > 1">
            <span class="mt-2">Damage Type:</span>
            <ChoiceWidget
              :choiceSet="damageTypeOptions"
              :iconSet="damageIcons"
              :selected="viewedDamageTypeSelected ?? ''"
              :clicked="
                (damageType) =>
                  viewed?.target.data
                    .setDamageType?.(damageType)
                    ?.then(() => updateDamageFormula())
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
        <ul>
          <li
            v-for="mod in viewed?.phase === 'damage'
              ? strikeModalDamage?.response?.modifiers
              : viewed?.target.data._modifiers"
            class="flex gap-2"
            :class="{ 'text-gray-300': !mod.enabled }"
            :key="mod.slug"
          >
            <div class="w-8 text-right">
              <span v-if="mod.modifier !== undefined">{{ formatModifier(mod.modifier) }}</span>
              <span v-if="mod.diceNumber">{{ `${mod.diceNumber}${mod.dieSize}` }}</span>
            </div>
            <div class="overflow-hidden text-ellipsis whitespace-nowrap">{{ mod.label }}</div>
            <div v-if="mod.damageType">({{ mod.damageType }})</div>
          </li>
        </ul>
        <template #actionButtons v-if="isListening">
          <Button
            v-if="viewed?.phase === 'attack'"
            color="blue"
            :clicked="
              () =>
                doViewedAttack()?.then((r) => {
                  strikeModal.close()
                  strikeModal.rollResultModal.open(r)
                })
            "
          >
            <span v-if="!viewed?.subtype">Strike&nbsp;</span>
            <span>{{
              viewed?.target.data.variants?.find(
                (v) =>
                  v.map === viewed?.subtype &&
                  v.type ===
                    (viewed?.target.kind === 'blast'
                      ? attackTypeMap.get(viewed.target.isMelee)
                      : undefined)
              )?.label
            }}</span>
          </Button>
          <Button
            v-if="viewed?.phase === 'damage'"
            :label="viewed?.subtype ? 'Critical' : 'Damage'"
            color="red"
            :clicked="
              () =>
                doViewedDamage()?.then((r) => {
                  strikeModal.close()
                  strikeModal.rollResultModal.open(r)
                })
            "
          />
        </template>
      </InfoModal>
    </Teleport>
  </div>
</template>
