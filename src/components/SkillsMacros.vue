<script setup lang="ts">
import Macro from '@/components/MacroBox.vue'

const props = defineProps(['skill', 'props'])
</script>
<template>
  <div v-if="props.skill.slug === 'acrobatics'">
    <Macro compendium="pf2e.action-macros" macro="55mxH0w8UkY1o3Xv">Balance</Macro>
    <Macro compendium="pf2e.action-macros" macro="50Q0DYL33Kalu1BH">Escape</Macro>
    <Macro compendium="pf2e.action-macros" macro="9Ul5Op5OceT9P5SS" v-if="props.skill.rank"
      >Maneuver in Flight</Macro
    >
    <Macro compendium="pf2e.action-macros" macro="UKHPveLpG7hUs4D0" v-if="props.skill.rank"
      >Squeeze</Macro
    >
    <Macro compendium="pf2e.action-macros" macro="2qhYHkcSsTJoSwrJ" v-if="props.skill.rank"
      >Tumble Through</Macro
    >
  </div>
  <div v-if="props.skill.slug === 'arcana'"></div>
  <div v-if="props.skill.slug === 'athletics'">
    <Macro compendium="pf2e.action-macros" macro="i95kcGLIQKOTsnv6"> Grapple </Macro>
    <Macro compendium="pf2e.action-macros" macro="yNry1xMZqdWHncbV"> Shove </Macro>
    <Macro compendium="pf2e.action-macros" macro="gRj7xUfcpUZQLrOC"> Trip </Macro>
  </div>
  <div v-if="props.skill.slug === 'crafting'"></div>
  <div v-if="props.skill.slug === 'deception'">
    <Macro compendium="pf2e.action-macros" macro="RjfPFjqPrNve6eeh">Feint</Macro>
  </div>
  <div v-if="props.skill.slug === 'diplomacy'">
    <Macro compendium="pf2e.action-macros" macro="EDLftLWLBefTFDtu">Bon Mot</Macro>
    <Macro compendium="pf2e.action-macros" macro="rCgGPEyXbzLFcio6">Gather Information</Macro>
    <Macro compendium="pf2e.action-macros" macro="1Sj2Pz3VI2SFWqZw">Make an Impression</Macro>
    <Macro compendium="pf2e.action-macros" macro="tbveXG4gaIoKnsWX">Request</Macro>
  </div>
  <div v-if="props.skill.slug === 'intimidation'">
    <Macro compendium="pf2e.action-macros" macro="9RNumMausgG7adgL">Coerce</Macro>
    <Macro compendium="pf2e.action-macros" macro="nEwqNNWX6scLt4sc">Demoralize</Macro>
  </div>
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
  <div v-if="props.skill.slug === 'stealth'">
    <Macro compendium="pf2e.action-macros" macro="zn0HadZeoKDALxRu">Conceal an Object</Macro>
    <Macro compendium="pf2e.action-macros" macro="FlM3HvpnsZpCKawG">Hide</Macro>
    <Macro compendium="pf2e.action-macros" macro="HSTkVuv0SjTNK3Xx">Sneak</Macro>
  </div>
  <div v-if="props.skill.slug === 'survival'"></div>
  <div v-if="props.skill.slug === 'thievery'">
    <Macro compendium="pf2e.action-macros" macro="8YrH37NzKRuiKFbF">Pick a Lock</Macro>
  </div>
</template>
@/composables/server @/types/pf2e-types
