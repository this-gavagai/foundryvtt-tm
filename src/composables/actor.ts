import type { Ref } from 'vue'
import type { TablemateActor } from '@/types/character-types'
import type { CharacterCore } from '@/composables/character/characterCore'
import type { CharacterResources } from '@/composables/character/characterResources'
import type { CharacterStats } from '@/composables/character/characterStats'
import type { CharacterActions } from '@/composables/character/characterActions'
import type { CharacterItems } from '@/composables/character/characterItems'
import type { CharacterRules } from '@/composables/character/characterRules'
import type { CharacterSkillActions } from '@/composables/character/characterSkillActions'
import type { CharacterSpells } from '@/composables/character/characterSpells'

// The surface shared by every sheet-bearing actor (characters, familiars).
// Components rendered by more than one sheet type must consume this interface
// (via useInjectedActor) rather than Character, so the compiler enforces that
// they only rely on fields every actor actually provides.
//
// Every member is typed via indexed access into the character model — the
// character sub-interfaces stay the single source of truth and the two can't
// drift apart. `_actor` is the one exception: it's the member whose type
// genuinely differs per actor shape, so the base holds the union.
export interface Actor {
  // Live underlying PF2e actor — escape hatch for code that needs the raw
  // serialized document (see CharacterCore._actor).
  _actor: Ref<TablemateActor | undefined>
  _id: CharacterCore['_id']
  name: CharacterCore['name']
  portraitUrl: CharacterCore['portraitUrl']
  portraitScaleX: CharacterCore['portraitScaleX']
  portraitScaleY: CharacterCore['portraitScaleY']
  hp: CharacterResources['hp']
  ac: CharacterStats['ac']
  saves: CharacterStats['saves']
  perception: CharacterStats['perception']
  skills: CharacterStats['skills']
  movement: CharacterCore['movement']
  effects: CharacterItems['effects']
  rollOptionLabels: CharacterCore['rollOptionLabels']
  traitLabels: CharacterCore['traitLabels']
  doDamage: CharacterActions['doDamage']

  // Optional capabilities: absent on actors that can't perform them. UI must
  // hide the affordance when undefined — do NOT implement these as silent
  // no-ops on a new actor shape.
  doCharacterAction?: CharacterActions['doCharacterAction']
  doFlatCheck?: CharacterStats['doFlatCheck']

  // Character-only features that shared chrome reads behind guards; absent on
  // actors that don't have them.
  proficiencies?: CharacterStats['proficiencies']
  shield?: CharacterStats['shield']
  rollOptions?: CharacterRules['rollOptions']
  skillActionsBySkill?: CharacterSkillActions['skillActionsBySkill']
  spellcastingEntries?: CharacterSpells['spellcastingEntries']
}
