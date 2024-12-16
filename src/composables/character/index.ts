// TODO (ux++): Audit all write methods for quick vs. slow feedback (adjust value before waiting for characterdetails return)
import type { Ref } from 'vue'
// import { ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'
// import { useWorld } from '../world'

import { type CharacterCore, useCharacterCore } from './characterCore'
import { type CharacterStats, useCharacterStats } from './characterStats'
import { type CharacterResources, useCharacterResources } from './characterResources'
import { type CharacterItems, useCharacterItems } from './characterItems'
import { type CharacterActions, useCharacterActions } from './characterActions'
import { type CharacterRules, useCharacterRules } from './characterRules'

// const { world } = useWorld()
// const worldCharacter = world

export interface Character
  extends CharacterCore,
    CharacterStats,
    CharacterResources,
    CharacterItems,
    CharacterActions,
    CharacterRules {}

export function useCharacter(actor: Ref<Actor | undefined>) {
  // watch(actor, () => console.log('TM actor changed', actor.value?._id))
  // watch(
  //   () => actor.value?.items,
  //   () => console.log('item changed'),
  //   { deep: 1 }
  // )
  const character: Character = {
    ...useCharacterCore(actor),
    ...useCharacterStats(actor),
    ...useCharacterResources(actor),
    ...useCharacterItems(actor),
    ...useCharacterActions(actor),
    ...useCharacterRules(actor)
  }
  return { character }
}

import type { Item } from './item'
import type { Stat } from './stat'
import type { Modifier } from './modifier'
import type { Strike } from './strike'
import type { Equipment, SpellcastingEntry, Spell } from './characterItems'
import type { Action } from './characterActions'
export type { Item, Stat, Modifier, Strike, Equipment, SpellcastingEntry, Spell, Action }
