<script setup lang="ts">
import { inject } from 'vue'
import { useServer } from '@/utils/server'

import Macro from '@/components/Macro.vue'

const actor: any = inject('actor')
const { socket } = useServer()
const props = defineProps(['skill', 'props'])

// console.log(prop/s)

function requestMacro(compendium: string, id: string) {
  socket.value.emit('module.tablemate', {
    action: 'runMacro',
    characterId: actor.value._id,
    compendium: compendium,
    macroId: id
  })
}
</script>
<template>
  <div v-if="props.skill.slug === 'acrobatics'">
    <div class="cursor-pointer" @click="requestMacro('pf2e.action-macros', '55mxH0w8UkY1o3Xv')">
      Balance
    </div>
    <div class="cursor-pointer" @click="requestMacro('pf2e.action-macros', '50Q0DYL33Kalu1BH')">
      Escape
    </div>
    <div
      class="cursor-pointer"
      @click="requestMacro('pf2e.action-macros', '9Ul5Op5OceT9P5SS')"
      v-if="props.skill.rank"
    >
      Maneuver in Flight
    </div>
    <div
      class="cursor-pointer"
      @click="requestMacro('pf2e.action-macros', 'UKHPveLpG7hUs4D0')"
      v-if="props.skill.rank"
    >
      Squeeze
    </div>
    <div class="cursor-pointer" @click="requestMacro('pf2e.action-macros', '2qhYHkcSsTJoSwrJ')">
      Tumble Through
    </div>
  </div>
  <div v-if="props.skill.slug === 'arcana'"></div>
  <div v-if="props.skill.slug === 'athletics'"></div>
  <div v-if="props.skill.slug === 'crafting'"></div>
  <div v-if="props.skill.slug === 'deception'"></div>
  <div v-if="props.skill.slug === 'diplomacy'"></div>
  <div v-if="props.skill.slug === 'intimidation'"></div>
  <div v-if="props.skill.slug === 'medicine'">
    <Macro compendium="pf2e.action-macros" macro="l5pbgrj8SSNtRGs8">
      Administer First Aid - Stabilize
    </Macro>
    <Macro compendium="pf2e.action-macros" macro="ZEWD4zcEDQwYhVT8">
      Administer First Aid - Stop Bleeding
    </Macro>
    <Macro compendium="pf2e.action-macros" macro="m4iM5r3TfvQs5Y2n" v-if="props.skill.rank">
      Treat Disease
    </Macro>
    <Macro compendium="pf2e.action-macros" macro="R03LRl2RBbsm6EcF" v-if="props.skill.rank">
      Treat Poison
    </Macro>
    <Macro compendium="pf2e.pf2e-macros" macro="6duZj0Ygiqv712rq" v-if="props.skill.rank">
      Treat Wounds
    </Macro>
  </div>
  <div v-if="props.skill.slug === 'nature'"></div>
  <div v-if="props.skill.slug === 'occultism'"></div>
  <div v-if="props.skill.slug === 'performance'"></div>
  <div v-if="props.skill.slug === 'religion'"></div>
  <div v-if="props.skill.slug === 'society'"></div>
  <div v-if="props.skill.slug === 'stealth'"></div>
  <div v-if="props.skill.slug === 'survival'"></div>
  <div v-if="props.skill.slug === 'thievery'"></div>
</template>
