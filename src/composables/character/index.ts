// TODO: is there a better way to do a complex object with many computed properties?
// TODO: why all this makeItem(...) as Item stuff? any way to avoid?
// TODO: should roll/delete/changeValue have return values?
// /TODO: add a Roll type here? or not?
import type { Ref } from 'vue'
import { watch } from 'vue'
import type { Actor } from '@/types/pf2e-types'

import { type Item } from './item'
import { type Stat } from './stat'
import { type Modifier } from './modifier'

import { type CharacterCore, useCharacterCore } from './characterCore'
import { type CharacterStats, useCharacterStats } from './characterStats'
import { type CharacterResources, useCharacterResources } from './characterResources'
import { type CharacterItems, useCharacterItems } from './characterItems'
import { type CharacterActions, useCharacterActions } from './characterActions'

export interface Character
  extends CharacterCore,
    CharacterStats,
    CharacterResources,
    CharacterItems,
    CharacterActions {}

export function useCharacter(actor: Ref<Actor | undefined>) {
  watch(actor, () => console.log('actor changed', actor.value?._id))
  const character: Character = {
    ...useCharacterCore(actor),
    ...useCharacterStats(actor),
    ...useCharacterResources(actor),
    ...useCharacterItems(actor),
    ...useCharacterActions(actor)
  }
  return { character }
}

export type { Stat, Modifier, Item }
