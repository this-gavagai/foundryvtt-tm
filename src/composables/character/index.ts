import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'

import { type CharacterCore, useCharacterCore } from './characterCore'
import { type CharacterStats, useCharacterStats } from './characterStats'
import { type CharacterResources, useCharacterResources } from './characterResources'
import { type CharacterItems, useCharacterItems } from './characterItems'
import { type CharacterActions, useCharacterActions } from './characterActions'
import { type CharacterRules, useCharacterRules } from './characterRules'

export interface Character
  extends CharacterCore,
    CharacterStats,
    CharacterResources,
    CharacterItems,
    CharacterActions,
    CharacterRules {}

export function useCharacter(actor: Ref<Actor | undefined>) {
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
