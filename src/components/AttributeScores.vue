<script setup lang="ts">
import { computed } from 'vue'
import StatBox from './widgets/StatBox.vue'
import { formatModifier } from '@/utils/formatters'
import { useInjectedActor } from '@/composables/injectKeys'

// `attributes` is optional on the shared actor surface — familiars have no
// ability scores and never render this — so read through it rather than
// destructuring the sub-fields directly.
const { attributes } = useInjectedActor()
const str = computed(() => attributes?.str.value)
const dex = computed(() => attributes?.dex.value)
const con = computed(() => attributes?.con.value)
const int = computed(() => attributes?.int.value)
const wis = computed(() => attributes?.wis.value)
const cha = computed(() => attributes?.cha.value)
</script>
<template>
  <div class="flex grow justify-between px-0 *:w-1/6">
    <StatBox
      :heading="$t('attributes.str')"
      :fullHeading="$t('attributesFull.str')"
      data-attribute-type="str"
      :data-attribute-score="str"
    >
      {{ formatModifier(str) }}
    </StatBox>
    <StatBox
      :heading="$t('attributes.dex')"
      :fullHeading="$t('attributesFull.dex')"
      data-attribute-type="dex"
      :data-attribute-score="dex"
    >
      {{ formatModifier(dex) }}
    </StatBox>
    <StatBox
      :heading="$t('attributes.con')"
      :fullHeading="$t('attributesFull.con')"
      data-attribute-type="con"
      :data-attribute-score="con"
    >
      {{ formatModifier(con) }}
    </StatBox>
    <StatBox
      :heading="$t('attributes.int')"
      :fullHeading="$t('attributesFull.int')"
      data-attribute-type="int"
      :data-attribute-score="int"
    >
      {{ formatModifier(int) }}
    </StatBox>
    <StatBox
      :heading="$t('attributes.wis')"
      :fullHeading="$t('attributesFull.wis')"
      data-attribute-type="wis"
      :data-attribute-score="wis"
    >
      {{ formatModifier(wis) }}
    </StatBox>
    <StatBox
      :heading="$t('attributes.cha')"
      :fullHeading="$t('attributesFull.cha')"
      data-attribute-type="cha"
      :data-attribute-score="cha"
    >
      {{ formatModifier(cha) }}
    </StatBox>
  </div>
</template>
