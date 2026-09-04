export const PF2E_ACTION_STAT_MAP: Record<string, string> = {
  trip: 'athletics',
  shove: 'athletics',
  grapple: 'athletics',
  disarm: 'athletics',
  'high-jump': 'athletics',
  'long-jump': 'athletics',
  'force-open': 'athletics',
  'tumble-through': 'acrobatics',
  'maneuver-in-flight': 'acrobatics',
  escape: 'athletics',
  demoralize: 'intimidation',
  'bon-mot': 'diplomacy',
  'create-a-diversion': 'deception',
  feint: 'deception',
  request: 'diplomacy',
  hide: 'stealth',
  sneak: 'stealth',
  seek: 'perception',
  'sense-motive': 'perception',
  'palm-an-object': 'thievery',
  steal: 'thievery',
  'pick-a-lock': 'thievery',
  'disable-a-device': 'thievery'
}

export const proficiencyLevels = [
  { labelKey: 'proficiencyLevels.untrained', color: 'text-black', dots: '' },
  { labelKey: 'proficiencyLevels.trained', color: 'text-blue-800', dots: '⠄' },
  { labelKey: 'proficiencyLevels.expert', color: 'text-purple-800', dots: '⠆' },
  { labelKey: 'proficiencyLevels.master', color: 'text-yellow-800', dots: '⠦' },
  { labelKey: 'proficiencyLevels.legendary', color: 'text-red-800', dots: '⠶' }
]
export const inventoryTypes = [
  { type: 'weapon', titleKey: 'inventoryTypes.weapon' },
  { type: 'shield', titleKey: 'inventoryTypes.shield' },
  { type: 'consumable', titleKey: 'inventoryTypes.consumable' },
  { type: 'equipment', titleKey: 'inventoryTypes.equipment' },
  { type: 'armor', titleKey: 'inventoryTypes.armor' },
  { type: 'treasure', titleKey: 'inventoryTypes.treasure' },
  { type: 'backpack', titleKey: 'inventoryTypes.backpack' }
]
export const actionTypes = [
  { type: 'action', titleKey: 'actionTypes.action' },
  { type: 'reaction', titleKey: 'actionTypes.reaction' },
  { type: 'free', titleKey: 'actionTypes.free' },
  { type: 'skill', titleKey: 'actionTypes.skill' }
]

// The PF2e system's conditions pack. This is the pack every condition UUID in
// the system points at (Compendium.pf2e.conditionitems.Item.<id>), so the id is
// as stable as the system's own data — there is nothing to derive it from.
// Used by the empty effects panel to open the browser straight at conditions.
export const PF2E_CONDITIONS_PACK = 'pf2e.conditionitems'
