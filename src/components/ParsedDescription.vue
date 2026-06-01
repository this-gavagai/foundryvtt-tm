<script setup lang="ts">
import type { ActiveRoll } from '@/types/api-types'
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { resolveFormula } from '@/utils/diceFormula'
import { useInjectedCharacter } from '@/composables/injectKeys'

const props = defineProps<{
  text: string | undefined
  labels?: Record<string, string>
  // Roll-data context for item-scoped refs (mirrors PF2e's getRollData() shape:
  // { item: { level, ... } }). Inline @Damage formulas resolve `@path.to.value`
  // refs against this before being encoded into the click handler so the
  // eventual roll already knows the dice count and works with armed-dice flows.
  // The `actor` slot is filled automatically from the injected character —
  // callers shouldn't need to thread actor data through.
  rollData?: Record<string, unknown>
  // Source item ID, forwarded with any inline @Damage click so the Foundry-
  // side handler can build a synthetic anchor and let PF2e's own click handler
  // render the chat card (item header, traits, modifiers).
  itemId?: string
}>()

// PF2e formulas reference `@actor.abilities.str.mod`, `@actor.level`, etc. —
// paths that on the server resolve through class getters on ActorPF2e (per
// pf2e/src/module/actor/base.ts, e.g. `get abilities() { return … }`,
// `get level() { return this.system.details.level.value }`). The client's
// actor is serialized JSON from parseActorData, so those getters are absent
// and the paths would otherwise dead-end at `actor.abilities`. Wrap the actor
// in a thin proxy that aliases the well-known getters back to their system-
// data sources for `resolveFormula`'s dotted-path walk.
const { _actor } = useInjectedCharacter()
function makeActorRollData(actor: typeof _actor.value): Record<string, unknown> | undefined {
  if (!actor) return undefined
  const system = actor.system
  return {
    ...actor,
    abilities: system?.abilities,
    attributes: system?.attributes,
    saves: system?.saves,
    skills: system?.skills,
    perception: system?.perception,
    details: system?.details,
    traits: system?.traits,
    level: system?.details?.level?.value,
    hitPoints: system?.attributes?.hp
  }
}
const fullRollData = computed<Record<string, unknown>>(() => ({
  ...props.rollData,
  actor: makeActorRollData(_actor.value) ?? (props.rollData?.actor as object | undefined)
}))

interface DescriptionForm extends HTMLFormElement {
  roll: RadioNodeList | HTMLInputElement
}

// Split a string on `|` only at bracket-depth zero — used to peel pipe-separated
// annotations off inline-roll payloads (e.g. @Damage[2d6[fire]|options:area-damage])
// without splitting inside bracketed type tags whose own contents may contain `|`.
function splitOnTopLevelPipe(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '[') depth++
    else if (c === ']') depth--
    else if (c === '|' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
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

  // @Damage[formula|opt:val|opt:val...]{label} — PF2e's inline @Damage accepts
  // pipe-separated annotations after the formula (e.g. `options:area-damage`,
  // `traits:fire,cold`, `name:Fireball`). The formula itself can contain
  // bracketed type tags whose pipes shouldn't count as separators. We capture
  // the whole outer content (any non-bracket chars or balanced [...] tags) and
  // then split on pipes at bracket-depth zero, using the first segment as the
  // formula. Annotations are currently ignored — the inline roll posts a typed
  // DamageRoll and doesn't apply rule-element predicates like `area-damage`.
  text = text?.replace(
    /@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/gm,
    (_, content, label) => {
      const formula = splitOnTopLevelPipe(content)[0] ?? ''
      const resolved = resolveFormula(formula, fullRollData.value)
      const obj = {
        action: 'damage',
        formula: resolved,
        label: label ?? resolved,
        itemId: props.itemId
      }
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
