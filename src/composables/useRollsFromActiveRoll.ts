import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActiveRoll, RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'

type SaveSlug = 'fortitude' | 'will' | 'reflex'
const SAVE_SLUGS: readonly SaveSlug[] = ['fortitude', 'will', 'reflex']

export function useRollsFromActiveRoll(
  activeRoll: Ref<ActiveRoll | undefined> | ComputedRef<ActiveRoll | undefined>
): ComputedRef<Roll[]> {
  const { t } = useI18n()
  const { doCharacterAction, doFreeDamage, doFlatCheck, saves, skills } = useInjectedCharacter()

  return computed<Roll[]>(() => {
    const ar = activeRoll.value
    if (!ar) return []
    const slug = ar.slug
    const label = ar.label ?? slug ?? ''
    const buttonLabel = `${t('common.roll')} ${label}`.trim()

    if (ar.action === 'action') {
      if (!slug) return []
      return [
        {
          key: `inline:action:${slug}`,
          label: buttonLabel,
          color: 'blue',
          dice: ['d20'],
          armed: true,
          execute: (faces) => doCharacterAction(slug, ar.params, faces?.[0])
        }
      ]
    }

    if (ar.action === 'damage' && ar.formula) {
      const formula = ar.formula
      const dice = parseDamageFormulaDice(formula)
      return [
        {
          key: `inline:damage:${formula}`,
          label: buttonLabel,
          color: 'blue',
          dice: dice.length ? dice : undefined,
          execute: (faces) =>
            doFreeDamage(formula, faces && dice.length ? makeDiceResults(dice, faces) : undefined)
        }
      ]
    }

    if (ar.action === 'check') {
      const rollOptions = { dc: ar.dc !== undefined ? Number(ar.dc) : undefined }
      let execute: (faces?: number[]) => Promise<RequestResolutionArgs | null>
      if (slug && (SAVE_SLUGS as readonly string[]).includes(slug)) {
        const saveSlug = slug as SaveSlug
        execute = (faces) =>
          saves[saveSlug].value?.roll?.(faces?.[0], rollOptions) ?? Promise.resolve(null)
      } else if (slug === 'flat') {
        execute = (faces) => doFlatCheck(faces?.[0], rollOptions)
      } else {
        execute = (faces) =>
          skills.value?.find((s) => s.slug === slug)?.roll?.(faces?.[0], rollOptions) ??
          Promise.resolve(null)
      }
      return [
        {
          key: `inline:check:${slug ?? ''}`,
          label: buttonLabel,
          color: 'blue',
          dice: ['d20'],
          armed: true,
          execute
        }
      ]
    }

    return []
  })
}
