<script setup lang="ts">
import type { ActiveRoll } from '@/types/api-types'
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{ text: string | undefined }>()

interface DescriptionForm extends HTMLFormElement {
  roll: RadioNodeList | HTMLInputElement
}

const activeRoll = ref<ActiveRoll>()

const emit = defineEmits(['checkInitiated'])

const parsedText = computed(() => {
  let text = props.text

  // [[/act slug variation=type proficiency=skill]]{Description}
  text = text?.replace(
    /\[\[\/act (?<slug>[^\s]+)[\s]*(?<params>.*?)\]\](\{(?<label>.+?)\})?/gm,
    (match, p1, p2, p3, p4, offset, string, groups) =>
      `<label class="has-checked:bg-blue-600 has-checked:text-white bg-gray-300 border-divider border -my-0.5 py-0.5 px-1 cursor-pointer whitespace-nowrap">
        <input class="bg-black mr-1 mt-1 absolute accent-black" type="radio" name="roll" value='${JSON.stringify(
          { action: 'action', slug: groups.slug, label: groups.label, paramsString: groups.params }
        )}'>
        <span class="pl-4">${groups.label ?? groups.slug}</span>
      </label>`
  )

  // @Check[type|showDC:all|dc:number]
  // text = text?.replace(
  //   /@Check\[(?<type>\w+)[^\]]*?dc:(?<dc>\d+)\]/gm,
  //   (match, p1, p2, offset, string, groups) =>
  //     `<label class="has-checked:bg-blue-600 has-checked:text-white bg-gray-300 border-divider border -my-0.5 py-0.5 px-1 cursor-pointer whitespace-nowrap">
  //       <input class="bg-black mr-1 mt-1 absolute accent-black" type="radio" name="roll" value='${JSON.stringify(
  //         { action: 'check', type: groups.type, dc: groups.dc }
  //       )}'>
  //       <span class="capitalize pl-4">${groups.type}</span> Check (DC ${groups.dc})
  //     </label>`
  // )

  // other, unparseable markup
  text = text
    ?.replace(/@(UUID|Compendium)\[.*?\]\{(.*?)\}/gm, '<span class="text-red-900">$2</span>')
    ?.replace(/\[\[\/r (.*)\]\]/gm, '<span class="text-green-900">$1</span>')
    ?.replace(
      /@Check\[(\w+)[^\]]*?dc:(\d+)\]/gm,
      '<span class="text-green-900 capitalize">$1 Check (DC $2)</span>'
    )
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
function formClick(event: Event) {
  event.preventDefault()
  console.log('bingbing')
  emit('checkInitiated', 'test')
  return false
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
  <form id="description" @change="formChange" @submit="formClick">
    <div v-html="parsedText"></div>
  </form>
</template>
