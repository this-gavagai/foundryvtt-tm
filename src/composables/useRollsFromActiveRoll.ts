import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActiveRoll, RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { useInjectedCharacter } from '@/composables/injectKeys'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'
import { rollInlineCheck } from '@/api/actionRpc'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'

type SaveSlug = 'fortitude' | 'will' | 'reflex'
const SAVE_SLUGS: readonly SaveSlug[] = ['fortitude', 'will', 'reflex']

export function useRollsFromActiveRoll(
  activeRoll: Ref<ActiveRoll | undefined> | ComputedRef<ActiveRoll | undefined>,
  modifierOverrides?: Ref<Record<string, boolean>>
): ComputedRef<Roll[]> {
  const { t } = useI18n()
  const { _actor, doCharacterAction, doDamage, doFlatCheck, saves, skills } = useInjectedCharacter()

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
          execute: (faces) => {
            const overrides = modifierOverrides?.value
            const hasOverrides = !!overrides && Object.keys(overrides).length > 0
            return doCharacterAction(
              slug,
              ar.params,
              faces?.[0],
              hasOverrides ? overrides : undefined,
              ar.statisticSlug
            )
          }
        }
      ]
    }

    if (ar.action === 'damage' && ar.formula) {
      const formula = ar.formula
      const dice = parseDamageFormulaDice(formula)
      const itemId = ar.itemId
      const damageInline = ar.damageInline
      return [
        {
          key: `inline:damage:${formula}`,
          label: buttonLabel,
          color: 'blue',
          dice: dice.length ? dice : undefined,
          execute: (faces) =>
            doDamage(formula, {
              diceResults: faces && dice.length ? makeDiceResults(dice, faces) : undefined,
              itemId,
              damageInline
            })
        }
      ]
    }

    if (ar.action === 'check') {
      const rollOptions = { dc: ar.dc !== undefined ? Number(ar.dc) : undefined }
      let execute: (faces?: number[]) => Promise<RequestResolutionArgs | null>
      // Inline-check pipeline kicks in when target-defense routing matters:
      // either an explicit `against` is set, or the slug is `spell-attack`
      // (which targets AC implicitly). PF2e's enricher then handles statistic
      // resolution, target DC lookup, trait/option propagation, and the
      // action-header chat card just like a native @Check anchor click.
      // Plain @Check[<skill>] / @Check[<save>] / @Check[flat] keep using the
      // fast direct-API paths below.
      const needsInline = !!ar.against || slug === 'spell-attack'
      if (needsInline && slug) {
        execute = (faces) => {
          if (!_actor.value) return Promise.resolve(null)
          const diceResults = faces?.[0] != null ? { d20: [faces[0]] } : undefined
          return rollInlineCheck(_actor as Ref<CharacterPF2e>, slug, {
            against: ar.against,
            itemId: ar.itemId,
            inline: ar.checkInline,
            diceResults
          }) as Promise<RequestResolutionArgs | null>
        }
      } else if (slug && (SAVE_SLUGS as readonly string[]).includes(slug)) {
        const saveSlug = slug as SaveSlug
        execute = (faces) => {
          const overrides = modifierOverrides?.value
          const opts = overrides && Object.keys(overrides).length
            ? { ...rollOptions, modifierOverrides: overrides }
            : rollOptions
          return saves[saveSlug].value?.roll?.(faces?.[0], opts) ?? Promise.resolve(null)
        }
      } else if (slug === 'flat') {
        execute = (faces) => doFlatCheck(faces?.[0], rollOptions)
      } else {
        execute = (faces) => {
          const overrides = modifierOverrides?.value
          const opts = overrides && Object.keys(overrides).length
            ? { ...rollOptions, modifierOverrides: overrides }
            : rollOptions
          return skills.value?.find((s) => s.slug === slug)?.roll?.(faces?.[0], opts) ??
            Promise.resolve(null)
        }
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
