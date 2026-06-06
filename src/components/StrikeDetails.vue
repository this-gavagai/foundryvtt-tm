<script setup lang="ts">
import Button from '@/components/widgets/ButtonWidget.vue'
import ChoiceWidget from '@/components/widgets/ChoiceWidget.vue'
import DropdownWidget from '@/components/widgets/DropdownWidget.vue'
import ActionIcons from '@/components/widgets/ActionIcons.vue'
import ModifierOverrideList from '@/components/ModifierOverrideList.vue'
import type { Modifier } from '@/composables/character'
import type { ViewedStrike } from '@/utils/strikes'

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

interface DamageData {
  response?: {
    modifiers?: Modifier[]
  }
}

defineProps<{
  viewed?: ViewedStrike
  damageData?: DamageData
  damageTypeOptions: string[]
  viewedDamageTypeSelected?: string
  blastActions?: string
  isListening: boolean
  effectiveEnabled: (mod: Modifier) => boolean
  isManuallyActivated: (mod: Modifier) => boolean
  isManuallyDeactivated: (mod: Modifier) => boolean
  isStackingLoser: (mod: Modifier) => boolean
  onToggleModifier: (mod: Modifier) => unknown
  onToggleLoaded: () => unknown
  onUpdateDamageType: (damageType: string) => unknown
  onSetBlastActions: (actions: string) => unknown
}>()
</script>

<template>
  <div data-component="StrikeDetails">
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
        :clicked="onToggleLoaded"
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
          :clicked="onUpdateDamageType"
        />
      </div>
      <ChoiceWidget
        v-if="viewed?.target.kind === 'blast'"
        :choiceSet="['1', '2']"
        :iconSet="actionIcons"
        :selected="blastActions ?? ''"
        :clicked="onSetBlastActions"
      />
    </div>
    <ModifierOverrideList
      class="mt-2"
      :modifiers="
        viewed?.phase === 'damage'
          ? damageData?.response?.modifiers
          : viewed?.target.data._modifiers
      "
      :toggleable="viewed?.phase === 'attack' || viewed?.phase === 'damage'"
      showAll
      showDamageType
      :effectiveEnabled="effectiveEnabled"
      :isManuallyActivated="isManuallyActivated"
      :isManuallyDeactivated="isManuallyDeactivated"
      :isStackingLoser="isStackingLoser"
      :onToggle="onToggleModifier"
    />
  </div>
</template>
