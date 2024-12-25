<script setup lang="ts">
// TODO: fix "Escape" action
import { computed, inject } from 'vue'
import type { Action, Item } from '@/composables/character'
import ButtonWidget from './widgets/ButtonWidget.vue'
import { useKeys } from '@/composables/injectKeys'

const props = defineProps<{ text: string | undefined; item: Item | Action | undefined }>()

const character = inject(useKeys().characterKey)!
const { doCharacterAction } = character

const actions = computed(() => {
  const new_format = [
    ...(props.text?.matchAll(
      /\[\[\/act (?<slug>[^\s]+)[\s]*(?<params>.*?)\]\](\{(?<label>.+?)\})?/gm
    ) ?? [])
  ].map((a) => ({
    input: a?.input,
    slug: a?.groups?.slug,
    label: a?.groups?.label,
    options: a?.groups?.params
      ?.split(' ')
      .reduce(
        (acc, cur) => ({ ...acc, [cur.split('=')[0]]: cur.split('=')[1] }),
        {} as Record<string, string>
      )
  }))
  const old_format = [
    ...(props.text?.matchAll(/<span data-pf2-action="(.+?)" data-pf2-glyph=".*">(.+?)<\/span>/gm) ??
      [])
  ].map((a) => ({
    input: a?.[0],
    slug: 'legacy.' + a?.[1],
    label: a?.[2],
    options: {}
  }))
  console.log([...new_format, ...old_format])
  return [...new_format, ...old_format]
})

const emit = defineEmits(['returned'])
defineExpose({ actions })
</script>

<template>
  <ButtonWidget
    v-for="action in actions"
    :key="action.input"
    color="blue"
    class="capitalize"
    :clicked="
      () =>
        doCharacterAction(action.slug ?? '', action.options)?.then((r) => {
          emit('returned', r)
        })
    "
  >
    Roll {{ action.label ?? action.slug?.replace('-', ' ') }}
  </ButtonWidget>
</template>
