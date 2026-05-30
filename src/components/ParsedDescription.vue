<script setup lang="ts">
import type { ActiveRoll } from '@/types/api-types'
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { resolveFormula } from '@/utils/diceFormula'

const props = defineProps<{
  text: string | undefined
  labels?: Record<string, string>
  // Roll-data context (mirrors PF2e's getRollData() shape — e.g.
  // { item: { level }, actor: { level, abilities } }). Inline @Damage formulas
  // resolve @path.to.value references against this before being encoded into
  // the click handler, so the eventual roll already knows the dice count and
  // works with armed-dice / pixel-dice flows.
  rollData?: Record<string, unknown>
}>()

interface DescriptionForm extends HTMLFormElement {
  roll: RadioNodeList | HTMLInputElement
}

const formRef = ref<HTMLFormElement>()
const activeRoll = ref<ActiveRoll>()

const emit = defineEmits(['checkInitiated', 'update:activeRoll'])

const parsedText = computed(() => {
  let text = props.text

  // [[/act slug variation=type proficiency=skill]]{Description}
  text = text?.replace(
    /\[\[\/act (?<slug>[^\s\]]+)[\s]*(?<params>.*?)\]\](\{(?<label>.+?)\})?/gm,
    (match, p1, p2, p3, p4, offset, string, groups) =>
      `<label class="has-checked:bg-blue-600 has-checked:text-white bg-gray-300 border-divider border -my-0.5 pb-px px-1 cursor-pointer whitespace-nowrap">
        <input class="bg-black mr-1 mt-1 absolute accent-black" type="radio" name="roll" value="${JSON.stringify(
          { action: 'action', slug: groups.slug, label: groups.label, paramsString: groups.params }
        ).replace(/"/g, '&quot;')}">
        <span class="pl-4"><span class="pf2-icon-inline">1</span>${groups.label ?? props.labels?.[groups.slug] ?? groups.slug}</span>
      </label> `
  )

  // @Check[type|showDC:all|dc:number]
  text = text?.replace(/@Check\[([^\]]+)\]/gm, (_, content) => {
    const parts = content.split('|')
    const obj: { [key: string]: string } = { action: 'check', slug: parts[0] }
    for (const part of parts.slice(1)) {
      const i = part.indexOf(':')
      obj[part.slice(0, i)] = part.slice(i + 1)
    }
    return `<label class="has-checked:bg-blue-600 has-checked:text-white bg-gray-300 border-divider border -my-0.5 pb-px px-1 cursor-pointer whitespace-nowrap">
        <input class="bg-black mr-1 mt-1 absolute accent-black" type="radio" name="roll" value="${JSON.stringify(obj).replace(/"/g, '&quot;')}">
        <span class="capitalize pl-4">${props.labels?.[obj.slug] ?? obj.name ?? obj.slug} Check (${obj.name ? obj.slug + ' ' : ''}DC ${obj.dc})</span>
      </label> `
  })

  // other, unparseable markup
  // @UUID/@Compendium[...]{label} — content never contains brackets
  text = text?.replace(
    /@(?:UUID|Compendium)\[([^\]]+)\]\{([^}]*)\}/gm,
    '<span data-type="compendiumLink" class="text-red-600">$2</span>'
  )

  // @Damage[formula]{label} — formula may contain multiple bracketed type tags
  // (e.g. 2d6[fire]+1d4[bleed], 2d6[fire,persistent]); label is optional. The
  // outer-content match accepts any sequence of non-bracket chars or balanced
  // [...] type tags, so multi-instance damage formulas parse cleanly.
  text = text?.replace(
    /@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/gm,
    (_, formula, label) => {
      const resolved = resolveFormula(formula, props.rollData)
      const obj = { action: 'damage', formula: resolved, label: label ?? resolved }
      return `<label class="has-checked:bg-blue-600 has-checked:text-white bg-gray-300 border-divider border -my-0.5 pb-px px-1 cursor-pointer whitespace-nowrap">
        <input class="bg-black mr-1 mt-1 absolute accent-black" type="radio" name="roll" value="${JSON.stringify(
          obj
        ).replace(/"/g, '&quot;')}">
        <span class="pl-4">${label ?? resolved}</span>
      </label> `
    }
  )

  // [[/r formula]] inline rolls — [^\]]* prevents overshooting past ]]
  text = text?.replace(/\[\[\/r ([^\]]*)\]\]/gm, '<span class="text-green-900">$1</span>')
  return text
})

function initRolls() {
  const form = formRef.value as DescriptionForm | undefined
  const rolls = form?.roll
  if (!rolls) {
    activeRoll.value = undefined
    emit('update:activeRoll', undefined)
    return
  }
  if (rolls instanceof RadioNodeList) (rolls[0] as HTMLInputElement).checked = true
  else if (rolls instanceof HTMLInputElement) rolls.checked = true
  formChange()
}

function formChange() {
  const form = formRef.value as DescriptionForm | undefined
  activeRoll.value = form?.roll ? JSON.parse(form.roll.value) : undefined
  if (activeRoll.value?.paramsString)
    activeRoll.value.params = activeRoll.value.paramsString
      .split(' ')
      .reduce(
        (acc, cur) => ({ ...acc, [cur.split('=')[0]]: cur.split('=')[1] }),
        {} as Record<string, string>
      )
  emit('update:activeRoll', activeRoll.value)
}
function formClick(event: Event) {
  event.preventDefault()
  emit('checkInitiated', 'test')
  return false
}
onMounted(initRolls)
watch(
  () => props.text,
  () => nextTick(initRolls)
)
defineExpose({ activeRoll })
</script>
<template>
  <form data-component="ParsedDescription" ref="formRef" @change="formChange" @submit="formClick">
    <div v-html="parsedText"></div>
  </form>
</template>
<style>
@font-face {
  font-family: Pathfinder2eActions;
  src: url(@/assets/Pathfinder2eActions.ttf);
}
.pf2-icon-inline {
  font-family: 'Pathfinder2eActions', sans-serif;
  padding-right: 5px;
  position: relative;
  top: -1px;
}
</style>
