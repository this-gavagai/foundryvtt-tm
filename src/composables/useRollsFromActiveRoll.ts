import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActiveRoll, RequestResolutionArgs } from '@/types/api-types'
import type { Roll } from '@/types/roll-types'
import { useInjectedActor } from '@/composables/injectKeys'
import { parseDamageFormulaDice, makeDiceResults } from '@/utils/diceFormula'
import { rollInlineCheck } from '@/api/actionRpc'
import { SignedNumber } from '@/utils/formatters'
import { useListenersStore } from '@/stores/listenersOnline'

type SaveSlug = 'fortitude' | 'will' | 'reflex'
const SAVE_SLUGS: readonly SaveSlug[] = ['fortitude', 'will', 'reflex']

export function useRollsFromActiveRoll(
  activeRoll: Ref<ActiveRoll | undefined> | ComputedRef<ActiveRoll | undefined>,
  modifierOverrides?: Ref<Record<string, boolean>>,
  // The modifier the button will roll at, as the caller resolved it: PF2e's
  // total for the statistic plus whatever the player has toggled. Quoted in the
  // label so a toggle in the panel is visible before the die is thrown.
  total?: Ref<number | undefined> | ComputedRef<number | undefined>
): ComputedRef<Roll[]> {
  const { t } = useI18n()
  const listeners = useListenersStore()
  const { _actor, doCharacterAction, doDamage, doFlatCheck, saves, skills, perception } =
    useInjectedActor()

  return computed<Roll[]>(() => {
    const ar = activeRoll.value
    if (!ar) return []
    // Every branch below ends in an RPC — the dice are PF2e's, on a Foundry
    // client — so with no GM listening an inline @Check or @Damage button can
    // only fail. Answer with no buttons, the same way StatBox's chits vanish
    // rather than sitting out the ack timeout. The description text they were
    // enriched from still reads normally.
    if (!listeners.isListening) return []
    const slug = ar.slug
    const label = ar.label ?? slug ?? ''
    const modifier = total?.value
    const buttonLabel = `${t('common.roll')} ${label} ${
      modifier === undefined ? '' : SignedNumber.format(modifier)
    }`
      .replace(/\s+/g, ' ')
      .trim()

    if (ar.action === 'action') {
      // Actors without the capability (familiars) get no button rather than
      // an armed control that silently does nothing.
      if (!slug || !doCharacterAction) return []
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
          return rollInlineCheck(_actor, slug, {
            against: ar.against,
            itemId: ar.itemId,
            inline: ar.checkInline,
            diceResults
          }) as Promise<RequestResolutionArgs | null>
        }
      } else if (slug === 'perception') {
        // Perception lives at `system.perception`, NOT in the skill list — so the
        // fallback branch below, which resolves the executor by searching
        // `skills`, found nothing and returned null. An inline
        // `@Check[perception|dc:20]` rendered a full modifier breakdown over a
        // button that did nothing at all.
        execute = (faces) => {
          const overrides = modifierOverrides?.value
          const opts =
            overrides && Object.keys(overrides).length
              ? { ...rollOptions, modifierOverrides: overrides }
              : rollOptions
          return perception?.value?.roll?.(faces?.[0], opts) ?? Promise.resolve(null)
        }
      } else if (slug && (SAVE_SLUGS as readonly string[]).includes(slug)) {
        const saveSlug = slug as SaveSlug
        execute = (faces) => {
          const overrides = modifierOverrides?.value
          const opts =
            overrides && Object.keys(overrides).length
              ? { ...rollOptions, modifierOverrides: overrides }
              : rollOptions
          return saves[saveSlug].value?.roll?.(faces?.[0], opts) ?? Promise.resolve(null)
        }
      } else if (slug === 'flat') {
        // Hide the affordance on actors without flat checks (familiars).
        if (!doFlatCheck) return []
        execute = (faces) => doFlatCheck(faces?.[0], rollOptions)
      } else {
        execute = (faces) => {
          const overrides = modifierOverrides?.value
          const opts =
            overrides && Object.keys(overrides).length
              ? { ...rollOptions, modifierOverrides: overrides }
              : rollOptions
          return (
            skills.value?.find((s) => s.slug === slug)?.roll?.(faces?.[0], opts) ??
            Promise.resolve(null)
          )
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
