import type { Ref } from 'vue'
import type { TablemateCharacter } from '@/types/character-types'

import { type CharacterCore, useCharacterCore } from './characterCore'
import { type CharacterStats, useCharacterStats } from './characterStats'
import { type CharacterResources, useCharacterResources } from './characterResources'
import { type CharacterItems, useCharacterItems } from './characterItems'
import { type CharacterSpells, useCharacterSpells } from './characterSpells'
import { type CharacterActions, useCharacterActions } from './characterActions'
import { type CharacterStrikes, useCharacterStrikes } from './characterStrikes'
import { type CharacterSkillActions, useCharacterSkillActions } from './characterSkillActions'
import { type CharacterRules, useCharacterRules } from './characterRules'

import type { Item } from './defs/item'
import type { Stat } from './defs/stat'
import type { Modifier } from './defs/modifier'
import type { Strike, ElementalBlast } from './defs/strikeDef'
import type { SkillActionForSkill } from './characterSkillActions'
import type { Equipment } from './defs/equipmentDef'
import type { Feat } from './defs/feat'
import type { Consumable } from './defs/consumable'
import type { Action } from './defs/action'
import type { Spell, SpellcastingEntry } from './defs/spellDef'
import type { Weapon } from './defs/weapon'
import type { Armor } from './defs/armor'
import type { Condition } from './defs/condition'
import type { Effect } from './defs/effect'
import type { IWR } from './characterStats'
import type { InventoryItem, EffectItem } from './characterItems'
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
  Action,
  Weapon,
  ElementalBlast,
  SkillActionForSkill,
  IWR,
  EffectItem,
  Armor,
  Condition,
  Effect
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
    CharacterSkillActions,
    CharacterRules {}

export function useCharacter(actor: Ref<TablemateCharacter | undefined>) {
  const character: Character = {
    ...useCharacterCore(actor),
    ...useCharacterStats(actor),
    ...useCharacterResources(actor),
    ...useCharacterItems(actor),
    ...useCharacterSpells(actor),
    ...useCharacterActions(actor),
    ...useCharacterStrikes(actor),
    ...useCharacterSkillActions(actor),
    ...useCharacterRules(actor)
  }
  return { character }
}
