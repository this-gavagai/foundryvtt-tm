import { computed, type Ref } from 'vue'
import type { CharacterPF2e, AbilityItemPF2e, FeatPF2e } from '@7h3laughingman/pf2e-types'
import type { Field, WritableField } from './helpers'
import type { DiceResults, RequestResolutionArgs } from '@/types/api-types'
import { type Modifier, makeModifiers } from './defs/modifier'
import { type Action, type ExplorationActivity, makeAction } from './defs/action'
import { characterAction, rollCheck, runActionable, rollDamage, useAction } from '@/api/actionRpc'
import { updateActor, updateActorItem } from '@/api/documents'
import { actionTypes } from '@/utils/constants'

export interface CharacterActions {
  doCharacterAction: (
    slug: string,
    options?: object | undefined,
    rollResult?: number | undefined,
    modifierOverrides?: Record<string, boolean>,
    statisticSlug?: string
  ) => Promise<RequestResolutionArgs | null>
  doDamage: (
    formula: string,
    opts?: {
      secret?: boolean
      diceResults?: DiceResults
      itemId?: string
      damageInline?: Record<string, string | true>
    }
  ) => Promise<RequestResolutionArgs | null>
  actions: Field<Action[]>
  explorationActivities: Field<ExplorationActivity[]>
  downtimeActivities: Field<Action[]>
  initiative: {
    stat: WritableField<string>
    modifiers: Field<Modifier[]>
    totalModifier: Field<number>
    roll: (
      result?: number | undefined,
      options?: object | undefined
    ) => Promise<RequestResolutionArgs | null>
  }
}

// The shape the activity tests below read, stated structurally: what the app
// holds is the plain JSON the Foundry side serialized (see itemsOfType in
// ./helpers), and only a handful of an item's fields decide these.
type AbilityLike = {
  type?: string
  system?: { traits?: { value?: readonly string[] }; actionType?: { value?: string } }
}

// The two traits that take an ability out of encounter play and into a mode of
// its own — a tab each on PF2e's character sheet, a panel each here. Order is
// load-bearing: PF2e tests exploration first and stops (an else-if chain in
// #prepareAbilities), so an ability carrying both is an exploration activity.
const ACTIVITY_TRAITS = ['exploration', 'downtime'] as const
export type ActivityTrait = (typeof ACTIVITY_TRAITS)[number]

function activityTrait(item: AbilityLike): ActivityTrait | undefined {
  return ACTIVITY_TRAITS.find((trait) => item.system?.traits?.value?.includes(trait))
}

// PF2e's own gate on what can be an activity (the item loop in its character
// sheet's #prepareAbilities): every ability item qualifies, but a feat only
// does when it carries an action cost of its own. Both traits' feats are all
// passive in PF2e's content — Cat Nap and Cozy Campfire for exploration, Train
// Animal and Rapid Retraining for downtime — because each one modifies an
// activity rather than being one, and PF2e lists none of them as something to
// do. Matching that keeps the two sheets showing the same lists.
function isActivity(item: AbilityLike, trait: ActivityTrait) {
  if (activityTrait(item) !== trait) return false
  const actionType = item.system?.actionType?.value
  return (
    item.type === 'action' || (item.type === 'feat' && !!actionType && actionType !== 'passive')
  )
}

export function useCharacterActions(actor: Ref<CharacterPF2e | undefined>): CharacterActions {
  const doCharacterAction = (
    slug: string,
    options: object | undefined = {},
    rollResult: number | undefined = undefined,
    modifierOverrides?: Record<string, boolean>,
    statisticSlug?: string
  ) => {
    return characterAction(
      actor,
      slug,
      options ?? {},
      {
        d20: [rollResult ?? 0]
      },
      modifierOverrides,
      statisticSlug
    )
  }
  const actions = computed(() =>
    actor.value?.items
      // Include both ability items (type 'action') and actionable feats/features.
      // Many reactions/free actions (e.g. Counterspell) are stored as feats with a
      // non-passive actionType rather than as separate granted action items.
      ?.filter(
        (i): i is AbilityItemPF2e<CharacterPF2e> | FeatPF2e<CharacterPF2e> =>
          i.type === 'action' || i.type === 'feat'
      )
      .filter((i) => actionTypes.map((a) => a.type).includes(i.system?.actionType?.value))
      // Exploration and downtime activities get panels of their own, exactly as
      // PF2e sorts them into their own tabs before it buckets anything by
      // action cost. Nothing in PF2e's own content lands here today (its
      // activity items are all passive, so the actionType filter above has
      // already dropped them) — this is what keeps a homebrew activity with a
      // real action cost from showing up in two places.
      .filter((i) => !activityTrait(i))
      .map((i) => {
        // PF2e-toolbelt's "actionable" feature attaches a macro UUID to an
        // action item. Newer toolbelt stores it under `actionable.linked`;
        // older versions used `actionable.macro`. We check both so the same
        // build works regardless of which version the GM is running. The
        // actual macro execution is server-side (see runActionable handler)
        // because the macro needs a Foundry context — what the link decides
        // here is only whether the Use button appears and where it routes.
        const tbFlag = (
          i?.flags as Record<
            string,
            { actionable?: { linked?: string; macro?: string } } | undefined
          >
        )?.['pf2e-toolbelt']?.actionable
        const macroId = tbFlag?.linked ?? tbFlag?.macro
        const typeValue = i.system?.actionType?.value
        const itemId = i._id
        const base = makeAction(i as AbilityItemPF2e<CharacterPF2e>) as Action
        return {
          ...base,
          actionType:
            typeValue !== 'action'
              ? (typeValue ?? null)
              : i.system?.traits.value.includes('skill')
                ? 'skill'
                : 'action',
          macroId,
          // A toolbelt actionable macro makes ANY action usable — that is the
          // whole point of attaching one — so it widens PF2e's own test rather
          // than being a separate button.
          usable: base.usable || !!macroId,
          // One tap, two possible routes. An actionable macro REPLACES the
          // default behavior (toolbelt hands the macro a `use()` callback to
          // opt back into it), so when one is attached it wins; otherwise this
          // is PF2e's own use path. Both spend the frequency — the native one
          // directly, the macro's by calling `use()`.
          doUse: () => {
            if (!itemId) return
            return macroId ? runActionable(actor, itemId) : useAction(actor, itemId)
          },
          // Only where there is a Frequency to correct. A direct field write,
          // the way PF2e's own sheet writes its frequency input — no card, no
          // handler, nothing for a macro to intercept.
          setUses:
            base.system?.frequency && itemId
              ? (newValue: number) =>
                  updateActorItem(actor, itemId, { system: { frequency: { value: newValue } } })
              : undefined
        }
      })
  )
  // The ability items PF2e would file under one of its activity tabs, in the
  // app's own Action shape. Both panels start here; only exploration adds
  // anything on top.
  const activitiesWithTrait = (trait: ActivityTrait) =>
    actor.value?.items
      ?.filter((i): i is AbilityItemPF2e<CharacterPF2e> | FeatPF2e<CharacterPF2e> =>
        isActivity(i, trait)
      )
      .map((i) => makeAction(i as AbilityItemPF2e<CharacterPF2e>) as Action)

  const byName = (a: Action, b: Action) => (a.name ?? '').localeCompare(b.name ?? '')

  // Which activities the character is currently doing while exploring.
  //
  // PF2e stores this as a flat array of item ids on the actor
  // (`system.exploration`) and does nothing else with it: no roll options, no
  // Stealth-for-initiative when Avoid Notice is up, no travel-speed math. The
  // array only feeds its own Exploration tab and the party sheet's "who is
  // doing what" board, and only the two Clear buttons and this toggle ever
  // write it — resting doesn't clear it. So this is a marker the app keeps in
  // step with PF2e's, not an automation: mark Search, and Search is what the
  // GM sees you doing.
  const explorationIds = computed(() => {
    // Declared in the system's template.json rather than in a data model, and
    // absent from the pf2e types package the app compiles against — hence the
    // narrow read. A payload from an older Foundry-side build has no such key
    // at all, which is what the array test covers.
    const ids = (actor.value?.system as { exploration?: string[] } | undefined)?.exploration
    return Array.isArray(ids) ? ids : []
  })

  // Prune before writing, as PF2e's own toggle does: nothing else ever cleans
  // this array, so an activity deleted while it was active would sit in it for
  // good. Sent as a whole array (the single allowlisted `system.exploration`
  // path) — there is no per-entry write.
  const setExploration = (ids: string[]) => {
    const live = ids.filter((id) => actor.value?.items?.some((i) => i._id === id))
    return updateActor(actor, { system: { exploration: live } })
  }

  const explorationActivities = computed(() =>
    activitiesWithTrait('exploration')
      ?.map((activity) => {
        const itemId = activity._id
        const active = !!itemId && explorationIds.value.includes(itemId)
        return {
          ...activity,
          active,
          toggleActive: () => {
            if (!itemId) return
            const ids = explorationIds.value
            return setExploration(active ? ids.filter((id) => id !== itemId) : [...ids, itemId])
          }
        }
      })
      // Active first, then by name — PF2e's Exploration tab draws the same two
      // buckets under separate headers, which a panel this size doesn't have
      // room for. Sorting carries the split instead, and the row's own mark
      // says which bucket a row is in.
      .sort((a, b) => Number(b.active) - Number(a.active) || byName(a, b))
  )

  // Craft, Earn Income, Retraining, Long-Term Rest: what the character can do
  // with days rather than minutes.
  //
  // A plain list, with no counterpart to exploration's active mark, because
  // PF2e stores no such thing — there is no `system.downtime` to mirror. Only
  // one downtime activity is ever underway, it's the GM who is tracking the
  // days it takes, and PF2e's own Downtime tab is likewise a list and nothing
  // more. So this panel answers "what can I do between adventures?" and stops
  // where PF2e stops.
  const downtimeActivities = computed(() => activitiesWithTrait('downtime')?.sort(byName))

  const initiative = {
    stat: computed({
      get: () => actor.value?.system?.initiative?.statistic,
      set: (newValue) => {
        actor.value!.system.initiative.statistic = newValue!
        const update = { system: { initiative: { statistic: newValue } } }
        // Fire-and-forget: recovery (refresh + rethrow) happens in updateActor.
        updateActor(actor, update).catch(() => {})
      }
    }),
    modifiers: computed(() => makeModifiers(actor.value?.system?.initiative?.modifiers)),
    totalModifier: computed(() => actor.value?.system?.initiative?.totalModifier),
    roll: (result: number | undefined, options: object | undefined = {}) => {
      return rollCheck(actor, 'initiative', undefined, { d20: [result ?? 0] }, [], options ?? {})
    }
  }

  const doDamage = (
    formula: string,
    opts: {
      secret?: boolean
      diceResults?: DiceResults
      itemId?: string
      damageInline?: Record<string, string | true>
    } = {}
  ) => rollDamage(actor, formula, opts)

  return {
    doCharacterAction,
    doDamage,
    actions,
    explorationActivities,
    downtimeActivities,
    initiative
  }
}
