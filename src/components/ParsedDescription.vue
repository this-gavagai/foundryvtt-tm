<script setup lang="ts">
import type { ActiveRoll } from '@/types/api-types'
import { ref, computed, onMounted, watch, nextTick } from 'vue'

const props = defineProps<{ text: string | undefined; labels?: Record<string, string> }>()

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
        <span class="pl-4 capitalize"><span class="pf2-icon-inline">1</span>${props.labels?.[groups.slug] ?? groups.label ?? groups.slug}</span>
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
  // @Damage[XdY[type]]{label} — formula may have one level of nested [type]; label is optional
  text = text?.replace(
    /@Damage\[([^\[\]]*(?:\[[^\]]*\])?[^\[\]]*)\](?:\{([^}]*)\})?/gm,
    (_, formula, label) =>
      `<span data-type="compendiumLink" class="text-red-600">${label ?? formula}</span>`
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
  <form ref="formRef" @change="formChange" @submit="formClick">
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
