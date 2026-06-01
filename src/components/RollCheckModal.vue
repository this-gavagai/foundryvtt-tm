<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { freeRoll } from '@/api/actions'
import InfoModal from '@/components/InfoModal.vue'
import Toggle from '@/components/widgets/ToggleWidget.vue'
import type { Roll } from '@/types/roll-types'
import type { RequestResolutionArgs } from '@/types/api-types'

const { t } = useI18n()
const {
  _id: characterId,
  skills,
  perception,
  saves,
  doFlatCheck
} = useInjectedCharacter()

const modalRef = ref()
const isSecret = ref(false)

// A roller groups a label with the dispatch function for one chit. Lets the
// template render uniformly: a single `<span>` per chit driven by `Roller[]`.
type Roller = {
  slug: string
  label: string
  italic?: boolean
  execute: (face?: number, options?: object) => Promise<RequestResolutionArgs | null>
}

// Single-select. When set, the d20 routes through that roller's execute. When
// undefined: raw d20 via freeRoll.
const activeSlug = ref<string | undefined>(undefined)
function toggleStat(slug: string) {
  activeSlug.value = activeSlug.value === slug ? undefined : slug
}

// Multi-select roll-option traits. Attached to the roll as both display labels
// (traits[]) and rule-element predicate options (extraRollOptions[]). For
// fortune/misfortune, we additionally drive PF2e's rollTwice mechanic so the
// roll actually becomes 2d20kh / 2d20kl. If both are selected, PF2e cancels
// them and rolls 1d20 (still emits both labels).
const TRAIT_OPTIONS = ['concentrate', 'manipulate', 'fortune', 'misfortune'] as const
type TraitOption = (typeof TRAIT_OPTIONS)[number]
const selectedTraits = ref<Set<TraitOption>>(new Set())
function toggleTrait(slug: TraitOption) {
  const next = new Set(selectedTraits.value)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  selectedTraits.value = next
}

// Roller groups, rendered as labeled sub-rows in the template. Order matters
// — saves and the spotlight rolls (perception/initiative) sit above the long
// skill list since they're rolled more often.
const saveRollers = computed<Roller[]>(() => [
  {
    slug: 'fortitude',
    label: saves.fortitude.value?.label ?? t('saves.fortitude'),
    execute: (face, opts) => saves.fortitude.value?.roll?.(face, opts) ?? Promise.resolve(null)
  },
  {
    slug: 'reflex',
    label: saves.reflex.value?.label ?? t('saves.reflex'),
    execute: (face, opts) => saves.reflex.value?.roll?.(face, opts) ?? Promise.resolve(null)
  },
  {
    slug: 'will',
    label: saves.will.value?.label ?? t('saves.will'),
    execute: (face, opts) => saves.will.value?.roll?.(face, opts) ?? Promise.resolve(null)
  }
])

const flatRollers: Roller[] = [
  {
    slug: 'flat-5',
    label: 'Flat DC 5',
    execute: (face, opts) => doFlatCheck(face, { ...(opts ?? {}), dc: 5 })
  },
  {
    slug: 'flat-11',
    label: 'Flat DC 11',
    execute: (face, opts) => doFlatCheck(face, { ...(opts ?? {}), dc: 11 })
  }
]

// Perception leads the skill list, followed by trained skills, with lore
// skills appended at the end in italics. Initiative is intentionally omitted —
// it's rolled from the combat tracker, not the side-menu check builder.
const skillRollers = computed<Roller[]>(() => {
  const list: Roller[] = []
  if (perception.value) {
    list.push({
      slug: perception.value.slug ?? 'perception',
      label: perception.value.label ?? t('saves.perception'),
      execute: (face, opts) => perception.value!.roll?.(face, opts) ?? Promise.resolve(null)
    })
  }
  for (const s of skills.value ?? []) {
    if (s.lore) continue
    list.push({
      slug: s.slug ?? '',
      label: s.label ?? s.slug ?? '',
      execute: (face, opts) => s.roll?.(face, opts) ?? Promise.resolve(null)
    })
  }
  for (const s of skills.value ?? []) {
    if (!s.lore) continue
    list.push({
      slug: s.slug ?? '',
      label: s.label ?? s.slug ?? '',
      italic: true,
      execute: (face, opts) => s.roll?.(face, opts) ?? Promise.resolve(null)
    })
  }
  return list
})

const allRollers = computed<Roller[]>(() => [
  ...saveRollers.value,
  ...flatRollers,
  ...skillRollers.value
])

const activeLabel = computed(
  () => allRollers.value.find((r) => r.slug === activeSlug.value)?.label ?? ''
)

const checkRolls = computed<Roll[]>(() => [
  {
    key: 'roll-check',
    label: activeLabel.value
      ? `${t('common.roll')} ${activeLabel.value}`
      : t('sideMenu.rollD20'),
    color: 'blue',
    dice: ['d20'],
    armed: true,
    execute: async (faces?: number[]) => {
      const roller = allRollers.value.find((r) => r.slug === activeSlug.value)
      // PF2e's Statistic.roll uses `messageMode` for chat-card visibility (with
      // Foundry's ChatMessageMode vocabulary: "public" | "gm" | "blind" | …),
      // distinct from `rollMode` (the Roll.toMessage vocabulary: "publicroll" |
      // "blindroll" | …). The two are not aliases — passing 'blindroll' here
      // silently falls through to the user's default. The freeRoll fallback
      // below uses Foundry's native path and keeps `rollMode`.
      const traitList = [...selectedTraits.value]
      // Fortune / misfortune drive rollTwice — see check.ts:124. PF2e cancels
      // both when both are flagged on the same roll, so only set rollTwice
      // when exactly one of the two is selected.
      const hasFortune = selectedTraits.value.has('fortune')
      const hasMisfortune = selectedTraits.value.has('misfortune')
      const rollTwice =
        hasFortune && !hasMisfortune
          ? 'keep-higher'
          : hasMisfortune && !hasFortune
            ? 'keep-lower'
            : undefined
      const options: Record<string, unknown> = {}
      if (isSecret.value) options.messageMode = 'blind'
      if (traitList.length) {
        options.traits = traitList
        options.extraRollOptions = traitList
      }
      if (rollTwice) options.rollTwice = rollTwice
      const result = roller
        ? await roller.execute(faces?.[0], options)
        : await freeRoll(characterId.value ?? '', isSecret.value, faces?.[0])
      // Reset selections after the roll fires so the next open starts fresh.
      activeSlug.value = undefined
      selectedTraits.value = new Set()
      return result
    }
  }
])

function open() {
  modalRef.value?.open()
}
function close() {
  modalRef.value?.close()
}

// Drop the active selection if the character switches under us and that slug
// no longer exists.
watch(skills, () => {
  if (activeSlug.value && !allRollers.value.find((r) => r.slug === activeSlug.value)) {
    activeSlug.value = undefined
  }
})

defineExpose({ open, close })
</script>
<template>
  <InfoModal ref="modalRef" :rolls="checkRolls">
    <template #title>{{ $t('sideMenu.freeRollTitle') }}</template>
    <template #bottomLeft>
      <Toggle :active="isSecret" @changed="(v: boolean) => (isSecret = v)">
        <span class="text-sm">{{ $t('sideMenu.secret') }}</span>
      </Toggle>
    </template>
    <template #beforeBody>
      <div data-component="RollCheckBuilder">
        <!-- Each sub-row groups thematically related rollers. The chip styling
             is shared across all rows via the `check-traits` data-part. -->
        <template
          v-for="(group, gi) in [
            { label: $t('rollCheck.saves'), rollers: saveRollers },
            { label: $t('rollCheck.flat'), rollers: flatRollers },
            { label: $t('rollCheck.skills'), rollers: skillRollers }
          ]"
          :key="gi"
        >
          <div v-if="group.rollers.length" class="mt-3">
            <h4 class="text-xs tracking-wide text-gray-600 uppercase">{{ group.label }}</h4>
            <div data-part="check-traits" class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="r in group.rollers"
                :key="r.slug"
                :data-active="activeSlug === r.slug ? '' : undefined"
                class="inline-block cursor-pointer rounded border border-gray-400 bg-gray-100 px-2 py-1 text-xs whitespace-nowrap text-gray-900 select-none active:bg-gray-300 data-active:border-blue-700 data-active:bg-blue-600 data-active:text-white"
                :class="{ italic: r.italic }"
                @click="toggleStat(r.slug)"
              >
                {{ r.label }}
              </span>
            </div>
          </div>
        </template>

        <!-- Multi-select roll-option traits. Attach to the roll as labels and
             rule-element predicate options; fortune/misfortune also drive PF2e's
             rollTwice mechanic. Only meaningful when a stat is selected (no
             statistic, no rule elements). -->
        <div class="mt-3">
          <h4 class="text-xs tracking-wide text-gray-600 uppercase">
            {{ $t('rollCheck.traits') }}
          </h4>
          <div data-part="check-traits" class="mt-1 flex flex-wrap gap-1">
            <span
              v-for="trait in TRAIT_OPTIONS"
              :key="trait"
              :data-active="selectedTraits.has(trait) ? '' : undefined"
              class="inline-block cursor-pointer rounded border border-gray-400 bg-gray-100 px-2 py-1 text-xs whitespace-nowrap text-gray-900 capitalize select-none active:bg-gray-300 data-active:border-blue-700 data-active:bg-blue-600 data-active:text-white"
              @click="toggleTrait(trait)"
            >
              {{ $t('rollCheck.trait.' + trait) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </InfoModal>
</template>
