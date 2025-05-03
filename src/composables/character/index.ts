import type { Ref } from 'vue'
import type { Actor } from '@/types/pf2e-types'

import { type CharacterCore, useCharacterCore } from './characterCore'
import { type CharacterStats, useCharacterStats } from './characterStats'
import { type CharacterResources, useCharacterResources } from './characterResources'
import { type CharacterItems, useCharacterItems } from './characterItems'
import { type CharacterSpells, useCharacterSpells } from './characterSpells'
import { type CharacterActions, useCharacterActions } from './characterActions'
import { type CharacterStrikes, useCharacterStrikes } from './characterStrikes'
import { type CharacterRules, useCharacterRules } from './characterRules'

export interface Character
  extends CharacterCore,
    CharacterStats,
    CharacterResources,
    CharacterItems,
    CharacterSpells,
    CharacterActions,
    CharacterStrikes,
    CharacterRules {}

// TODO: switch these imports over to objects rather than functions so that errors show up in more useful places
export function useCharacter(actor: Ref<Actor | undefined>) {
  const character: Character = {
    ...useCharacterCore(actor),
    ...useCharacterStats(actor),
    ...useCharacterResources(actor),
    ...useCharacterItems(actor),
    ...useCharacterSpells(actor),
    ...useCharacterActions(actor),
    ...useCharacterStrikes(actor),
    ...useCharacterRules(actor)
  }
  return { character }
}

import type { Item } from './item'
import type { Stat } from './stat'
import type { Modifier } from './modifier'
import type { Strike } from './strike'
import type { Equipment } from './characterItems'
import type { SpellcastingEntry, Spell } from './characterSpells'
import type { Action } from './characterActions'
export type { Item, Stat, Modifier, Strike, Equipment, SpellcastingEntry, Spell, Action }
