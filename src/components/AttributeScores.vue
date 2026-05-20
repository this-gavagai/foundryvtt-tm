<script setup lang="ts">

import StatBox from './widgets/StatBox.vue'
import { formatModifier } from '@/utils/utilities'
import { useInjectedCharacter } from '@/composables/injectKeys'

const character = useInjectedCharacter()
const { str, dex, con, int, wis, cha } = character.attributes
</script>
<template>
  <div class="flex justify-between px-6 py-4 [&>*]:w-1/6">
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
