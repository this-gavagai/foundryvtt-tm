<script setup lang="ts">
import { inject, ref, watch, computed } from 'vue'
import { formatModifier } from '@/utils/utilities'
import { useKeys } from '@/composables/injectKeys'
import { useListeners } from '@/composables/listenersOnline'
import InfoModal from './InfoModal.vue'
import Button from '@/components/widgets/ButtonWidget.vue'
import StrikeActionSet from './StrikeListActionSet.vue'
import type { Strike } from '@/composables/character'
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
import type { ElementalBlast } from '@/composables/character/strike'
const damageIcons = { bludgeoning, slashing, piercing, electricity, fire, cold, vitality }
const actionIcons = { '1': action1, '2': action2 }

interface Trait {
  label: string | undefined
}
interface ViewedStrikeOptions {
  melee?: boolean
  type?: 'strike' | 'strike_damage' | 'blast' | 'blast_damage'
  strikeType?: 'strike' | 'blast'
  attackType?: 'melee' | 'ranged'
  subtype?: number
  altUsage?: number | undefined
}

const character = inject(useKeys().characterKey)!
const { strikes, blasts, inventory, actions, blastActions } = character

const strikeModal = ref()
const strikeModalDamage = ref()

const { isListening } = useListeners()

// calculated fields for InfoModal
const viewedStrikeId = ref<number | undefined>()
const viewedStrikeOptions = ref<ViewedStrikeOptions | undefined>()
const viewedStrike = computed(() => {
  if (viewedStrikeId.value === undefined) return undefined
  return viewedStrikeOptions.value?.strikeType === 'blast'
    ? blasts.value?.[viewedStrikeId.value]
    : viewedStrikeOptions.value?.altUsage === undefined
      ? strikes.value?.[viewedStrikeId.value]
      : strikes.value?.[viewedStrikeId.value]?.altUsages[viewedStrikeOptions.value.altUsage]
})
const viewedStrikeItem = computed(() => {
  return [...(inventory.value || []), ...(actions.value || [])].find(
    (i) => i._id === viewedStrike.value?.item?._id
  )
})
const viewedStrikeTraits = computed(() => {
  return viewedStrike.value?.traits
    ?.concat(viewedStrike.value?.weaponTraits)
    ?.map((t: Trait) => t.label ?? '')
    ?.concat(
      viewedStrike.value?.hasOwnProperty('isBlast')
        ? (viewedStrikeItem.value?.system?.traits.value ?? [])
        : []
    )
    ?.concat(
      viewedStrike.value?.hasOwnProperty('isBlast')
        ? [
            viewedStrikeItem.value?.flags?.pf2e?.damageSelections?.[
              (viewedStrike.value as ElementalBlast)?.blastElement as keyof object
            ] ?? ''
          ].filter((i) => i && !['bludgeoning', 'piercing', 'slashing'].includes(i))
        : []
    )
})
const viewedStrikeDamageTypeSelected = computed(() => {
  return viewedStrike.value?.hasOwnProperty('isBlast')
    ? viewedStrikeItem.value?.flags?.pf2e?.damageSelections?.[
        (viewedStrike.value as ElementalBlast)?.blastElement as keyof object
      ]
    : (viewedStrikeItem.value?.system?.traits?.toggles.modular?.selected ??
        viewedStrikeItem.value?.system?.traits?.toggles.versatile?.selected ??
        viewedStrikeItem.value?.system?.damage?.damageType)
})
const damageTypeOptions = computed(() => {
  if (viewedStrike.value?.hasOwnProperty('isBlast')) {
    return (viewedStrike.value as ElementalBlast)?.blastDamageTypes?.map((x) => x.value) as string[]
  } else {
    const types = new Set()
    const item = viewedStrikeItem.value
    types.add(item?.system?.damage?.damageType)
    if (item?.system?.traits?.value?.includes('versatile-b')) types.add('bludgeoning')
    if (item?.system?.traits?.value?.includes('versatile-p')) types.add('piercing')
    if (item?.system?.traits?.value?.includes('modular'))
      ['slashing', 'piercing', 'bludgeoning'].forEach((item) => types.add(item))
    if (item?.system?.traits?.value?.includes('versatile-s')) types.add('slashing')
    return Array.from(types) as string[]
  }
})
function viewedStrikeAction(
  diceResult: number | undefined = undefined
): Promise<RequestResolutionArgs | null> {
  if (viewedStrike.value?.hasOwnProperty('isBlast')) {
    const element = (viewedStrike.value as ElementalBlast)?.blastElement ?? ''
    const damageType =
      viewedStrike.value?.item?.flags?.pf2e?.damageSelections?.[
        (viewedStrike.value as ElementalBlast)?.blastElement as keyof object
      ] ??
      (viewedStrike.value as ElementalBlast)?.blastDamageTypes?.[0].value ??
      ''
    return (
      (viewedStrike.value?.doStrike?.(
        viewedStrikeOptions.value?.subtype ?? 0,
        undefined,
        {
          element,
          damageType,
          isMelee: viewedStrikeOptions.value?.melee ?? true
        },
        diceResult ?? undefined
      ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  } else {
    if (viewedStrikeId.value === undefined) return Promise.resolve(null)
    const rootStrike = strikes.value?.[viewedStrikeId.value]
    return (
      (rootStrike?.doStrike?.(
        viewedStrikeOptions.value?.subtype ?? 0,
        viewedStrikeOptions.value?.altUsage,
        undefined,
        diceResult ?? undefined
      ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  }
}
function viewedDamageAction(): Promise<RequestResolutionArgs> {
  if (viewedStrike.value?.hasOwnProperty('isBlast')) {
    const element = (viewedStrike.value as ElementalBlast)?.blastElement ?? ''
    const damageType =
      viewedStrike.value?.item?.flags?.pf2e?.damageSelections?.[
        (viewedStrike.value as ElementalBlast)?.blastElement as keyof object
      ] ??
      (viewedStrike.value as ElementalBlast)?.blastDamageTypes?.[0].value ??
      ''
    return (
      (viewedStrike.value?.doDamage?.(viewedStrikeOptions.value?.subtype ?? 0, undefined, {
        element,
        damageType,
        isMelee: viewedStrikeOptions.value?.melee ?? true
      }) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  } else {
    return (
      (viewedStrike.value?.doDamage?.(
        viewedStrikeOptions.value?.subtype ?? 0,
        viewedStrikeOptions.value?.altUsage
      ) as Promise<RequestResolutionArgs>) ?? Promise.resolve(null)
    )
  }
}

// helpers
const attackTypeMap = new Map([
  [undefined, undefined],
  [true, 'melee'],
  [false, 'ranged']
])

async function updateDamageFormula() {
  if (!isListening) return
  const isStrike = !viewedStrike.value?.hasOwnProperty('isBlast')
  if (isStrike) {
    strikeModalDamage.value = await (viewedStrike.value as Strike)?.getDamage?.(
      viewedStrikeOptions.value?.altUsage
    )
    console.log(strikeModalDamage.value)
  } else {
    const element = (viewedStrike.value as ElementalBlast)?.blastElement ?? ''
    const damageType =
      viewedStrike.value?.item?.flags?.pf2e?.damageSelections?.[
        (viewedStrike.value as ElementalBlast)?.blastElement as keyof object
      ] ??
      (viewedStrike.value as ElementalBlast)?.blastDamageTypes?.[0].value ??
      ''
    strikeModalDamage.value = await viewedStrike.value?.getDamage?.(undefined, {
      element,
      damageType,
      isMelee: strikeModal.value?.options?.melee
    })
  }
}
watch(viewedStrike, async () => updateDamageFormula())
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
                @clicked="
                  (id, options) => {
                    viewedStrikeId = i
                    viewedStrikeOptions = {
                      ...options,
                      strikeType: 'blast',
                      melee: attackType === 'melee'
                    }
                    strikeModal.open()
                  }
                "
              />
            </div>
          </li>
        </ul>
      </div>
      <div class="break-inside-avoid [&:not(:has(li))]:hidden [div_&:not(:hidden)]:pt-2">
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
              :label="strike?.item?.name ?? strike?.label"
              :isRanged="strike?.item?.system?.range ?? NaN > 0"
              :range="strike?.item?.system?.range"
              :mapLabelSet="strike.variants"
              @clicked="
                (id: string, options: object) => {
                  viewedStrikeId = i
                  viewedStrikeOptions = { ...options, strikeType: 'strike' }
                  strikeModal.open()
                }
              "
            />
            <div v-for="(altUsage, j) in strike?.altUsages" :key="strike.slug + '_alt_' + j">
              <StrikeActionSet
                type="strike"
                :id="i"
                :label="altUsage?.item?.name ?? altUsage?.label"
                :isRanged="altUsage?.item?.system?.range ?? NaN > 0"
                :range="altUsage?.item?.system?.range"
                :mapLabelSet="altUsage?.variants"
                @clicked="
                  (id: string, options: object) => {
                    viewedStrikeId = i
                    viewedStrikeOptions = { ...options, strikeType: 'strike', altUsage: j }
                    strikeModal.open()
                  }
                "
              />
            </div>
          </li>
        </ul>
      </div>
    </div>
    <Teleport to="#modals">
      <InfoModal
        ref="strikeModal"
        :itemId="viewedStrikeItem?._id"
        :traits="viewedStrikeTraits ?? []"
        :diceRequest="
          viewedStrikeOptions?.type === 'strike' || viewedStrikeOptions?.type === 'blast'
            ? ['d20']
            : undefined
        "
        @diceResult="
          (diceResult: number | undefined) =>
            viewedStrikeAction(diceResult)?.then((r) => {
              strikeModal.close()
              strikeModal.rollResultModal.open(r)
            })
        "
        :imageUrl="
          (viewedStrike as ElementalBlast)?.blastImg ??
          viewedStrikeItem?.img ??
          'icons/skills/melee/unarmed-punch-fist.webp'
        "
      >
        <template #title>{{ viewedStrike?.label }}</template>
        <template #description>{{
          viewedStrikeOptions?.type?.match('_damage') && viewedStrikeOptions?.subtype === 1
            ? strikeModalDamage?.response?.critical
            : strikeModalDamage?.response?.damage
        }}</template>
        <template #default>
          <div class="m-1">
            <DropdownWidget
              class="relative"
              :growContainer="true"
              v-if="viewedStrike?.ammunition?.compatible?.length"
              :list="
                [{ id: '', name: 'No ammo' }].concat(viewedStrike?.ammunition?.compatible ?? [])
              "
              :selectedId="viewedStrike?.ammunition?.selected?.id ?? ''"
              :changed="(newId) => viewedStrike?.changeAmmo?.(newId)"
            />
          </div>
          <div
            class="pb-2"
            v-if="
              (viewedStrike as ElementalBlast)?.blastRange?.max ?? viewedStrike?.item?.system?.range
            "
          >
            Range:
            {{
              viewedStrikeOptions?.melee
                ? undefined
                : ((viewedStrike as ElementalBlast)?.blastRange?.max ??
                  viewedStrike?.item?.system?.range)
            }}
            ft.
          </div>
          <div class="flex justify-end gap-2">
            <div v-if="damageTypeOptions.length > 1">
              <span class="mt-2">Damage Type:</span>
              <ChoiceWidget
                :choiceSet="damageTypeOptions ?? []"
                :iconSet="damageIcons"
                :selected="viewedStrikeDamageTypeSelected ?? ''"
                :clicked="
                  (damageType) => {
                    console.log(damageType, viewedStrike)
                    return strikes?.[viewedStrikeId ?? 0]
                      ?.setDamageType?.(damageType)
                      ?.then((r) => {
                        updateDamageFormula()
                      })
                  }
                "
              />
            </div>
            <ChoiceWidget
              v-if="viewedStrikeOptions?.type?.match('blast')"
              :choiceSet="['1', '2']"
              :iconSet="actionIcons"
              :selected="blastActions + ''"
              :clicked="(newChoice) => (blastActions = newChoice)"
            />
          </div>
          <ul>
            <li
              v-for="mod in viewedStrikeOptions?.type?.match('_damage')
                ? strikeModalDamage?.response?.modifiers
                : viewedStrike?._modifiers"
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
        </template>
        <template #actionButtons v-if="isListening">
          <Button
            v-if="viewedStrikeOptions?.type === 'strike' || viewedStrikeOptions?.type === 'blast'"
            color="blue"
            :clicked="
              () =>
                viewedStrikeAction()?.then((r) => {
                  console.log(r)
                  strikeModal.close()
                  strikeModal.rollResultModal.open(r)
                })
            "
          >
            <span v-if="!viewedStrikeOptions?.subtype">Strike&nbsp;</span>
            <span>{{
              viewedStrike?.variants?.find(
                (v) =>
                  v.map === viewedStrikeOptions?.subtype &&
                  v.type === attackTypeMap.get(viewedStrikeOptions?.melee)
              )?.label
            }}</span>
          </Button>
          <Button
            v-if="viewedStrikeOptions?.type?.match('_damage')"
            :label="viewedStrikeOptions?.subtype ? 'Critical' : 'Damage'"
            color="red"
            :clicked="
              () =>
                viewedDamageAction()?.then((r) => {
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
