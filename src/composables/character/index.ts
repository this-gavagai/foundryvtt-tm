import type { Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'

import { type CharacterCore, useCharacterCore } from './characterCore'
import { type CharacterStats, useCharacterStats } from './characterStats'
import { type CharacterResources, useCharacterResources } from './characterResources'
import { type CharacterItems, useCharacterItems } from './characterItems'
import { type CharacterSpells, useCharacterSpells } from './characterSpells'
import { type CharacterActions, useCharacterActions } from './characterActions'
import { type CharacterStrikes, useCharacterStrikes } from './characterStrikes'
import { type CharacterRules, useCharacterRules } from './characterRules'

import type { Item } from './defs/item'
import type { Stat } from './defs/stat'
import type { Modifier } from './defs/modifier'
import type { Strike } from './defs/strike'
import type { Equipment, InventoryItem, Feat, Consumable } from './characterItems'
import type { SpellcastingEntry, Spell } from './characterSpells'
import type { Action } from './defs/action'
export type {
  Item,
  Stat,
  Modifier,
  Strike,
  Equipment,
  InventoryItem,
  Feat,
  Consumable,
  SpellcastingEntry,
  Spell,
  Action
}

export interface Character
  extends
    CharacterCore,
    CharacterStats,
    CharacterResources,
    CharacterItems,
    CharacterSpells,
    CharacterActions,
    CharacterStrikes,
    CharacterRules {}

export function useCharacter(actor: Ref<CharacterPF2e | undefined>) {
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
