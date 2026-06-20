<script setup lang="ts">
import type { ActiveRoll } from '@/types/api-types'
import { ref, computed, onBeforeUnmount, onMounted, watch, nextTick } from 'vue'
import { simplifyFormula, simplifyFormulaHtml } from '@/utils/diceFormula'
import {
  applyPf2eNotation,
  escapeHtml,
  pf2eActionHtml,
  pf2eCheckHtml,
  pf2eDamageHtml,
  pf2eGlyphHtml,
  pf2eTraitHtml,
  pf2eUuidHtml
} from '@/utils/pf2eEnrich'
import { resolveCompendiumName } from '@/utils/compendiumNames'
import {
  activeRollFromFoundryClickTarget,
  compendiumUuidFromClickTarget
} from '@/utils/foundryHtml'
import { normalizeFoundryAssetUrls } from '@/utils/chatHtml'
import { useInjectedCharacter } from '@/composables/injectKeys'
import CompendiumItemModal from '@/components/CompendiumItemModal.vue'

const props = withDefaults(
  defineProps<{
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
    autoSelect?: boolean
  }>(),
  { autoSelect: true }
)

const shouldAutoSelect = computed(() => props.autoSelect !== false)

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

const formRef = ref<HTMLFormElement>()
const activeRoll = ref<ActiveRoll>()
let observer: MutationObserver | undefined
let initTimer: number | undefined

const emit = defineEmits(['checkInitiated', 'update:activeRoll'])

function rollInputHtml(roll: ActiveRoll): string {
  return `<input class="bg-black mr-1 mt-1 absolute accent-black" type="radio" name="roll" value="${JSON.stringify(roll).replace(/"/g, '&quot;')}">`
}

function selectableRollLabel(content: string, roll: ActiveRoll, contentClass = 'pl-4'): string {
  return `<label class="bg-gray-300 border-divider border -my-0.5 pb-px px-1 cursor-pointer whitespace-nowrap mr-1">
        ${rollInputHtml(roll)}
        <span class="${contentClass}">${content}</span>
      </label> `
}

function selectableRollsFromEnrichedHtml(html: string | undefined): string | undefined {
  if (!html) return html
  const template = document.createElement('template')
  template.innerHTML = html
  template.content
    .querySelectorAll<HTMLElement>(
      '[data-pf2-action], a.inline-check[data-pf2-check], a.inline-roll'
    )
    .forEach((element) => {
      const roll = activeRollFromFoundryClickTarget(element)
      if (!roll) return
      if ((roll.action === 'check' || roll.action === 'damage') && props.itemId && !roll.itemId) {
        roll.itemId = props.itemId
      }
      const wrapper = document.createElement('span')
      wrapper.innerHTML = selectableRollLabel(element.innerHTML, roll)
      element.replaceWith(
        wrapper.firstElementChild ?? document.createTextNode(element.textContent ?? '')
      )
    })
  return template.innerHTML
}

const parsedText = computed(() => {
  const text = applyPf2eNotation(props.text, {
    action: (slug, params, label) =>
      pf2eActionHtml({
        slug,
        params,
        label,
        content: `<span class="pf2-icon-inline">1</span>${escapeHtml(
          label ?? props.labels?.[slug] ?? slug
        )}`
      }),

    check: (slug, inline, dc, against) => {
      const display =
        props.labels?.[slug] ?? (typeof inline.name === 'string' ? inline.name : undefined) ?? slug
      return pf2eCheckHtml({ slug, inline, dc, against, label: display })
    },

    uuid: pf2eUuidHtml,

    // @Damage[formula|opt:val...]{label} — pipe-separated annotations forwarded
    // as `damageInline` so the Foundry handler can reconstruct a native enriched
    // anchor and let PF2e's _onClickInlineRoll receive the full context.
    damage: (formula, damageInline, label) => {
      const resolvedPlain = simplifyFormula(formula, fullRollData.value)
      const obj: ActiveRoll = {
        action: 'damage',
        formula: resolvedPlain,
        label: label ?? resolvedPlain,
        itemId: props.itemId,
        damageInline: Object.keys(damageInline).length ? damageInline : undefined
      }
      // Without an explicit label, highlight computed sub-expressions in green.
      const displayContent = label ?? simplifyFormulaHtml(formula, fullRollData.value)
      return pf2eDamageHtml(resolvedPlain, damageInline, obj.label, displayContent)
    },

    glyph: pf2eGlyphHtml,

    trait: pf2eTraitHtml,

    inlineRoll: (formula) => `<span class="text-green-900">${escapeHtml(formula)}</span>`
  })

  const selectableText = normalizeFoundryAssetUrls(selectableRollsFromEnrichedHtml(text))
  if (!shouldAutoSelect.value) return selectableText
  return selectableText?.replace(
    /(<input\b(?=[^>]*\btype="radio")(?=[^>]*\bname="roll")[^>]*)(>)/,
    '$1 checked$2'
  )
})

// Label-less @UUID[...] links render with a "…" placeholder (see pf2eUuidHtml);
// resolve the referenced document's name and fill it in once it lands.
function fillUuidLabels() {
  formRef.value
    ?.querySelectorAll<HTMLAnchorElement>('a.content-link[data-uuid][data-uuid-unresolved]')
    .forEach((anchor) => {
      const uuid = anchor.dataset.uuid
      anchor.removeAttribute('data-uuid-unresolved')
      if (!uuid) return
      resolveCompendiumName(uuid).then((name) => {
        if (name) anchor.textContent = name
      })
    })
}

function syncSelectedLabel() {
  const form = formRef.value
  form?.querySelectorAll('label[data-selected]').forEach((label) => {
    label.removeAttribute('data-selected')
  })
  form
    ?.querySelector<HTMLInputElement>('input[name="roll"]:checked')
    ?.closest('label')
    ?.setAttribute('data-selected', '')
}

function initRolls() {
  const form = formRef.value
  const rolls = form?.querySelectorAll<HTMLInputElement>('input[name="roll"]')
  if (!form || !rolls?.length) {
    activeRoll.value = undefined
    emit('update:activeRoll', undefined)
    return
  }
  if (!shouldAutoSelect.value) {
    activeRoll.value = undefined
    emit('update:activeRoll', undefined)
    return
  }
  const checkedRoll = form.querySelector<HTMLInputElement>('input[name="roll"]:checked') ?? rolls[0]
  checkedRoll.defaultChecked = true
  checkedRoll.checked = true
  formChange()
}

function scheduleInitRolls() {
  if (initTimer !== undefined) window.clearTimeout(initTimer)
  initTimer = window.setTimeout(() => {
    initTimer = undefined
    initRolls()
    fillUuidLabels()
  }, 0)
}

function formChange() {
  const checkedRoll = formRef.value?.querySelector<HTMLInputElement>('input[name="roll"]:checked')
  syncSelectedLabel()
  activeRoll.value = checkedRoll ? JSON.parse(checkedRoll.value) : undefined
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
onMounted(() => {
  if (formRef.value) {
    observer = new MutationObserver(scheduleInitRolls)
    observer.observe(formRef.value, { childList: true, subtree: true })
  }
  nextTick(scheduleInitRolls)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (initTimer !== undefined) window.clearTimeout(initTimer)
})
watch(parsedText, () => nextTick(scheduleInitRolls), { flush: 'post' })

const compendiumModal = ref()

function handleDescriptionClick(event: MouseEvent) {
  const uuid = compendiumUuidFromClickTarget(event.target as HTMLElement)
  if (uuid) {
    event.preventDefault()
    event.stopPropagation()
    compendiumModal.value.open(uuid)
    return
  }

  const rollInput = (event.target as HTMLElement)
    .closest('label')
    ?.querySelector<HTMLInputElement>('input[name="roll"]')
  if (rollInput?.checked) window.setTimeout(formChange, 0)
}

defineExpose({ activeRoll, initRolls: scheduleInitRolls })
</script>
<template>
  <form data-component="ParsedDescription" ref="formRef" @change="formChange" @submit="formClick">
    <div v-html="parsedText" @click="handleDescriptionClick"></div>
    <Teleport to="#modals">
      <CompendiumItemModal ref="compendiumModal" />
    </Teleport>
  </form>
</template>
<style>
@font-face {
  font-family: Pathfinder2eActions;
  src: url(@/assets/Pathfinder2eActions.ttf);
}
.pf2-icon-inline,
.action-glyph {
  font-family: 'Pathfinder2eActions', sans-serif;
  padding-right: 5px;
  position: relative;
  top: -1px;
}

[data-component='ParsedDescription'] label[data-selected] {
  background-color: rgb(37 99 235);
  color: white;
}
</style>
