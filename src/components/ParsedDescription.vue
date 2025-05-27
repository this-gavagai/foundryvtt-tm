<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
const props = defineProps<{ text: string | undefined }>()

interface DescriptionForm extends HTMLFormElement {
  roll: RadioNodeList | HTMLInputElement
}

const activeRoll = ref<{
  slug: string
  label: string
  paramsString?: string
  params?: Record<string, string>
}>()

const parsedText = computed(() => {
  let text = props.text

  // [[/act slug variation=type proficiency=skill]]{Description}
  const inline_actions = /\[\[\/act (?<slug>[^\s]+)[\s]*(?<params>.*?)\]\](\{(?<label>.+?)\})?/gm
  text = text?.replace(
    inline_actions,
    (match, p1, p2, p3, p4, offset, string, groups) =>
      `<label class="has-checked:bg-blue-600 has-checked:text-white bg-gray-300 border-divider border -my-0.5 py-0.5 px-1 cursor-pointer whitespace-nowrap">
        <input class="bg-black mr-1 mt-1 absolute accent-black" type="radio" name="roll" value='${JSON.stringify({ slug: groups.slug, label: groups.label, paramsString: groups.params })}'
        ><span class="pl-4">${groups.label ?? groups.slug}</span></label>`
  )

  text = text
    ?.replace(/@(UUID|Compendium)\[.*?\]\{(.*?)\}/gm, '<span class="text-red-900">$2</span>')
    ?.replace(/\[\[\/r (.*)\]\]/gm, '<span class="text-green-900">$1</span>')

  return text
})

function formChange() {
  const form = document.getElementById('description')
  activeRoll.value = (form as DescriptionForm)?.roll
    ? JSON.parse((form as DescriptionForm)?.roll?.value)
    : undefined
  if (activeRoll.value?.paramsString)
    activeRoll.value.params = activeRoll.value.paramsString
      .split(' ')
      .reduce(
        (acc, cur) => ({ ...acc, [cur.split('=')[0]]: cur.split('=')[1] }),
        {} as Record<string, string>
      )
}
onMounted(() => {
  const rolls = (document.getElementById('description') as DescriptionForm)?.roll
  if (!rolls) return
  if (rolls instanceof RadioNodeList) (rolls[0] as HTMLInputElement).checked = true
  else if (rolls instanceof HTMLInputElement) rolls.checked = true
  formChange()
})
defineExpose({ activeRoll })
</script>
<template>
  <form id="description" @change="formChange">
    <div v-html="parsedText"></div>
  </form>
</template>
