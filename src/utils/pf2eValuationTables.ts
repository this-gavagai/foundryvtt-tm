// PF2e's rune, precious-material and item-grade valuation tables, TRANSCRIBED.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS A DELIBERATE DUPLICATION OF SYSTEM DATA, AND IT WILL GO STALE.
//
// Everything else in this app derives from data the server actually sends. This
// file does not: it is a copy of tables that live inside the PF2e system bundle,
// taken from **pf2e 8.4.1**. PF2e keeps them module-private — they are not on
// `CONFIG.PF2E`, and precious-material pricing is a rule rather than a set of
// compendium items, so there is nothing to read them from at runtime. Copying
// was the only way to value a runed or precious-material item without a GM.
//
// The trade was made knowingly: an item's level and price are display figures,
// not numbers anyone rolls against, and having the whole inventory work offline
// was judged worth a table that needs re-checking.
//
// WHEN TO REVISIT
//   * Any PF2e release that adds property runes, precious materials, item
//     grades, or changes a price. New content is the common case — a rune added
//     in a new book is simply missing here, and an item carrying it falls back
//     to its stored price rather than being valued.
//   * Any release that reshapes the tables themselves (renamed grades, a fourth
//     material grade, a different pricing rule). That is the dangerous case,
//     because the shape below would still parse and quietly be wrong.
//
// HOW YOU FIND OUT
//   The stamp already carries the world's PF2e version, and a figure derived
//   against a version the engine was not read against is downgraded to
//   `unverified` no matter how clean its ledger (see versionVerdict). This file
//   is covered by that gate: it is pinned to the version below, and the sheet
//   marks anything valued with it once the world moves on.
//
//   To refresh: re-read `Vn` (weapon property runes), `Bn` (armour property
//   runes), `ds` (materials) and `CONFIG.PF2E.*Improvements` (grades) out of the
//   system bundle, and regenerate. Keep the shape; only the numbers move.
// ─────────────────────────────────────────────────────────────────────────────

// The PF2e release these tables were read from. Compared against the world's
// system version to decide whether a valuation can still be called exact.
export const VALUATION_SYSTEM_VERSION = '8.4.1'

// Compact on purpose — `l`/`p`/`r` for level, price and rarity initial — because
// this is 160-odd entries that no one edits by hand.
export interface RuneValue {
  l: number
  p: number
  r: string
}
export interface GradeValue {
  l: number
  c: number
}

const RARITY: Record<string, string> = { c: 'common', u: 'uncommon', r: 'rare', q: 'unique' }
export const rarityOf = (entry: { r: string }): string => RARITY[entry.r] ?? 'common'

// Weapon property runes: slug → level, price in gp, rarity.
export const WEAPON_PROPERTY_RUNES: Record<string, RuneValue> = {
  ancestralEchoing: { l: 15, p: 9500, r: 'r' },
  anchoring: { l: 10, p: 900, r: 'u' },
  ashen: { l: 9, p: 700, r: 'c' },
  astral: { l: 8, p: 450, r: 'c' },
  authorized: { l: 3, p: 50, r: 'c' },
  bane: { l: 4, p: 100, r: 'u' },
  bloodbane: { l: 8, p: 475, r: 'u' },
  bloodthirsty: { l: 16, p: 8500, r: 'u' },
  bolkasBlessing: { l: 5, p: 160, r: 'u' },
  brilliant: { l: 12, p: 2000, r: 'c' },
  called: { l: 7, p: 350, r: 'c' },
  coating: { l: 9, p: 700, r: 'c' },
  conducting: { l: 7, p: 300, r: 'c' },
  corrosive: { l: 8, p: 500, r: 'c' },
  crushing: { l: 3, p: 50, r: 'u' },
  cunning: { l: 5, p: 140, r: 'c' },
  dancing: { l: 13, p: 2700, r: 'u' },
  deathdrinking: { l: 7, p: 360, r: 'r' },
  decaying: { l: 8, p: 500, r: 'c' },
  deflecting: { l: 6, p: 230, r: 'c' },
  demolishing: { l: 6, p: 225, r: 'r' },
  disrupting: { l: 5, p: 150, r: 'c' },
  earthbinding: { l: 5, p: 125, r: 'c' },
  energizing: { l: 6, p: 250, r: 'u' },
  energyVulnerability: { l: 4, p: 90, r: 'c' },
  extending: { l: 9, p: 700, r: 'c' },
  fanged: { l: 2, p: 30, r: 'u' },
  fearsome: { l: 5, p: 160, r: 'c' },
  flaming: { l: 8, p: 500, r: 'c' },
  flickering: { l: 6, p: 250, r: 'u' },
  flurrying: { l: 7, p: 360, r: 'c' },
  frost: { l: 8, p: 500, r: 'c' },
  ghostTouch: { l: 4, p: 75, r: 'c' },
  giantKilling: { l: 8, p: 450, r: 'r' },
  greaterAnchoring: { l: 18, p: 22000, r: 'u' },
  greaterAshen: { l: 16, p: 9000, r: 'c' },
  greaterAstral: { l: 15, p: 6000, r: 'c' },
  greaterBloodbane: { l: 13, p: 2800, r: 'u' },
  greaterBolkasBlessing: { l: 11, p: 1400, r: 'u' },
  greaterBrilliant: { l: 18, p: 24000, r: 'c' },
  greaterCorrosive: { l: 15, p: 6500, r: 'c' },
  greaterCrushing: { l: 9, p: 650, r: 'u' },
  greaterDecaying: { l: 15, p: 6500, r: 'c' },
  greaterDisrupting: { l: 14, p: 4300, r: 'u' },
  greaterEnergyVulnerability: { l: 16, p: 9000, r: 'c' },
  greaterExtending: { l: 13, p: 3000, r: 'c' },
  greaterFanged: { l: 8, p: 425, r: 'u' },
  greaterFearsome: { l: 12, p: 2000, r: 'c' },
  greaterFlaming: { l: 15, p: 6500, r: 'c' },
  greaterFrost: { l: 15, p: 6500, r: 'c' },
  greaterGiantKilling: { l: 15, p: 6000, r: 'r' },
  greaterHauling: { l: 11, p: 1300, r: 'u' },
  greaterImpactful: { l: 17, p: 15000, r: 'c' },
  greaterKolssOath: { l: 11, p: 1400, r: 'u' },
  greaterRooting: { l: 11, p: 1400, r: 'c' },
  greaterShock: { l: 15, p: 6500, r: 'c' },
  greaterThundering: { l: 15, p: 6500, r: 'c' },
  greaterTruddsStrength: { l: 11, p: 1400, r: 'u' },
  grievous: { l: 9, p: 700, r: 'c' },
  hauling: { l: 6, p: 225, r: 'u' },
  holy: { l: 11, p: 1400, r: 'c' },
  hooked: { l: 5, p: 140, r: 'r' },
  hopeful: { l: 11, p: 1200, r: 'u' },
  impactful: { l: 10, p: 1000, r: 'c' },
  impossible: { l: 20, p: 70000, r: 'c' },
  keen: { l: 13, p: 3000, r: 'u' },
  kinWarding: { l: 3, p: 52, r: 'u' },
  kolssOath: { l: 5, p: 160, r: 'u' },
  majorFanged: { l: 15, p: 6000, r: 'u' },
  majorRooting: { l: 15, p: 6500, r: 'c' },
  merciful: { l: 4, p: 70, r: 'c' },
  nightmare: { l: 9, p: 250, r: 'u' },
  pacifying: { l: 5, p: 150, r: 'u' },
  returning: { l: 3, p: 55, r: 'c' },
  rooting: { l: 7, p: 360, r: 'c' },
  serrating: { l: 10, p: 1000, r: 'u' },
  shifting: { l: 6, p: 225, r: 'c' },
  shock: { l: 8, p: 500, r: 'c' },
  shockwave: { l: 13, p: 3000, r: 'c' },
  speed: { l: 16, p: 10000, r: 'r' },
  spellStoring: { l: 13, p: 2700, r: 'u' },
  swarming: { l: 9, p: 700, r: 'c' },
  thundering: { l: 8, p: 500, r: 'c' },
  truddsStrength: { l: 5, p: 160, r: 'u' },
  trueRooting: { l: 19, p: 40000, r: 'c' },
  underwater: { l: 3, p: 50, r: 'c' },
  unholy: { l: 11, p: 1400, r: 'c' },
  vorpal: { l: 17, p: 15000, r: 'r' },
  wounding: { l: 7, p: 340, r: 'c' }
}

// Armour property runes.
export const ARMOR_PROPERTY_RUNES: Record<string, RuneValue> = {
  acidResistant: { l: 8, p: 420, r: 'c' },
  advancing: { l: 9, p: 625, r: 'c' },
  aimAiding: { l: 6, p: 225, r: 'c' },
  antimagic: { l: 15, p: 6500, r: 'u' },
  assisting: { l: 5, p: 125, r: 'c' },
  bitter: { l: 9, p: 135, r: 'u' },
  coldResistant: { l: 8, p: 420, r: 'c' },
  convincing: { l: 5, p: 45, r: 'c' },
  deathless: { l: 7, p: 330, r: 'u' },
  electricityResistant: { l: 8, p: 420, r: 'c' },
  energyAdaptive: { l: 13, p: 2600, r: 'c' },
  ethereal: { l: 17, p: 13500, r: 'c' },
  fireResistant: { l: 8, p: 420, r: 'c' },
  fortification: { l: 12, p: 2000, r: 'c' },
  glamered: { l: 5, p: 140, r: 'c' },
  gliding: { l: 8, p: 450, r: 'c' },
  greaterAcidResistant: { l: 12, p: 1650, r: 'c' },
  greaterAdvancing: { l: 16, p: 8000, r: 'c' },
  greaterColdResistant: { l: 12, p: 1650, r: 'c' },
  greaterConvincing: { l: 8, p: 450, r: 'c' },
  greaterDread: { l: 18, p: 21000, r: 'u' },
  greaterElectricityResistant: { l: 12, p: 1650, r: 'c' },
  greaterFireResistant: { l: 12, p: 1650, r: 'c' },
  greaterFortification: { l: 19, p: 24000, r: 'c' },
  greaterInvisibility: { l: 10, p: 1000, r: 'c' },
  greaterMoonweave: { l: 13, p: 3000, r: 'c' },
  greaterQuenching: { l: 10, p: 1000, r: 'c' },
  greaterReady: { l: 11, p: 1200, r: 'c' },
  greaterShadow: { l: 9, p: 650, r: 'c' },
  greaterSlick: { l: 8, p: 450, r: 'c' },
  greaterStanching: { l: 9, p: 600, r: 'u' },
  greaterSunweave: { l: 11, p: 1200, r: 'c' },
  greaterSwallowSpike: { l: 12, p: 1750, r: 'c' },
  greaterWinged: { l: 19, p: 35000, r: 'c' },
  immovable: { l: 12, p: 1800, r: 'u' },
  implacable: { l: 11, p: 1200, r: 'u' },
  invisibility: { l: 8, p: 500, r: 'c' },
  lesserDread: { l: 6, p: 225, r: 'u' },
  magnetizing: { l: 10, p: 900, r: 'c' },
  majorConvincing: { l: 16, p: 9000, r: 'c' },
  majorMoonweave: { l: 17, p: 14000, r: 'c' },
  majorQuenching: { l: 14, p: 4500, r: 'c' },
  majorShadow: { l: 17, p: 14000, r: 'c' },
  majorSlick: { l: 16, p: 9000, r: 'c' },
  majorStanching: { l: 13, p: 2500, r: 'u' },
  majorSunweave: { l: 18, p: 24000, r: 'c' },
  majorSwallowSpike: { l: 16, p: 19250, r: 'c' },
  malleable: { l: 9, p: 650, r: 'c' },
  misleading: { l: 16, p: 8000, r: 'c' },
  mobile: { l: 5, p: 60, r: 'c' },
  moderateDread: { l: 12, p: 1800, r: 'u' },
  moonweave: { l: 5, p: 140, r: 'c' },
  portable: { l: 9, p: 660, r: 'c' },
  quenching: { l: 6, p: 250, r: 'c' },
  raiment: { l: 5, p: 140, r: 'c' },
  ready: { l: 6, p: 200, r: 'c' },
  rockBraced: { l: 13, p: 3000, r: 'r' },
  safeguarding: { l: 13, p: 2600, r: 'c' },
  selfSealing: { l: 7, p: 320, r: 'c' },
  shadow: { l: 5, p: 55, r: 'c' },
  sidestepping: { l: 13, p: 3000, r: 'u' },
  sinisterKnight: { l: 8, p: 500, r: 'u' },
  sizeChanging: { l: 7, p: 350, r: 'c' },
  slick: { l: 5, p: 45, r: 'c' },
  soaring: { l: 14, p: 3750, r: 'c' },
  spellwatch: { l: 13, p: 3000, r: 'c' },
  stanching: { l: 5, p: 130, r: 'u' },
  sunweave: { l: 6, p: 350, r: 'c' },
  swallowSpike: { l: 6, p: 200, r: 'c' },
  trueQuenching: { l: 18, p: 24000, r: 'c' },
  trueStanching: { l: 17, p: 12500, r: 'u' },
  unnerving: { l: 7, p: 350, r: 'c' },
  winged: { l: 13, p: 2500, r: 'c' }
}

// Precious materials, by item kind then material then grade. Shields split
// three ways because PF2e prices a buckler, a shield and a tower shield
// differently for the same material.
export const MATERIALS: Record<string, Record<string, Record<string, RuneValue>>> = {
  armor: {
    abysium: { standard: { l: 12, p: 2000, r: 'r' }, high: { l: 19, p: 40000, r: 'r' } },
    adamantine: { standard: { l: 12, p: 1600, r: 'u' }, high: { l: 19, p: 32000, r: 'u' } },
    'cold-iron': {
      low: { l: 5, p: 140, r: 'c' },
      standard: { l: 11, p: 1200, r: 'c' },
      high: { l: 18, p: 20000, r: 'c' }
    },
    dawnsilver: { standard: { l: 12, p: 1600, r: 'u' }, high: { l: 19, p: 32000, r: 'u' } },
    djezet: { standard: { l: 12, p: 1800, r: 'r' }, high: { l: 19, p: 35000, r: 'r' } },
    dragonhide: { standard: { l: 12, p: 1600, r: 'u' }, high: { l: 19, p: 32000, r: 'u' } },
    dreamweb: { standard: { l: 5, p: 150, r: 'r' }, high: { l: 14, p: 3000, r: 'r' } },
    duskwood: { standard: { l: 12, p: 1600, r: 'u' }, high: { l: 19, p: 32000, r: 'u' } },
    'grisantian-pelt': { standard: { l: 12, p: 1800, r: 'r' }, high: { l: 19, p: 33000, r: 'r' } },
    inubrix: { standard: { l: 11, p: 1200, r: 'r' }, high: { l: 18, p: 18000, r: 'r' } },
    'keep-stone': { high: { l: 20, p: 56000, r: 'r' } },
    noqual: { standard: { l: 12, p: 1600, r: 'r' }, high: { l: 19, p: 32000, r: 'r' } },
    orichalcum: { high: { l: 20, p: 55000, r: 'r' } },
    siccatite: { standard: { l: 12, p: 1600, r: 'r' }, high: { l: 19, p: 32000, r: 'r' } },
    silver: {
      low: { l: 5, p: 140, r: 'c' },
      standard: { l: 11, p: 1200, r: 'c' },
      high: { l: 18, p: 20000, r: 'c' }
    },
    'sisterstone-dusk': {
      low: { l: 5, p: 140, r: 'r' },
      standard: { l: 10, p: 1000, r: 'r' },
      high: { l: 18, p: 19500, r: 'r' }
    },
    'sisterstone-scarlet': {
      low: { l: 5, p: 140, r: 'r' },
      standard: { l: 10, p: 1000, r: 'r' },
      high: { l: 18, p: 19500, r: 'r' }
    },
    'sovereign-steel': { standard: { l: 13, p: 2400, r: 'r' }, high: { l: 20, p: 50000, r: 'r' } }
  },
  weapon: {
    abysium: { standard: { l: 12, p: 2000, r: 'r' }, high: { l: 18, p: 24000, r: 'r' } },
    adamantine: { standard: { l: 11, p: 1400, r: 'u' }, high: { l: 17, p: 13500, r: 'u' } },
    'cold-iron': {
      low: { l: 2, p: 40, r: 'c' },
      standard: { l: 10, p: 880, r: 'c' },
      high: { l: 16, p: 9000, r: 'c' }
    },
    dawnsilver: { standard: { l: 11, p: 1400, r: 'u' }, high: { l: 17, p: 13500, r: 'u' } },
    djezet: { standard: { l: 12, p: 1800, r: 'r' }, high: { l: 18, p: 22000, r: 'r' } },
    duskwood: { standard: { l: 11, p: 1400, r: 'u' }, high: { l: 17, p: 13500, r: 'u' } },
    inubrix: { standard: { l: 11, p: 1400, r: 'r' }, high: { l: 17, p: 13500, r: 'r' } },
    'keep-stone': { high: { l: 18, p: 22500, r: 'r' } },
    noqual: { standard: { l: 12, p: 1600, r: 'r' }, high: { l: 18, p: 24000, r: 'r' } },
    orichalcum: { high: { l: 18, p: 22500, r: 'r' } },
    peachwood: { standard: { l: 12, p: 2000, r: 'u' }, high: { l: 18, p: 19000, r: 'u' } },
    siccatite: { standard: { l: 11, p: 1400, r: 'r' }, high: { l: 17, p: 15000, r: 'r' } },
    silver: {
      low: { l: 2, p: 40, r: 'c' },
      standard: { l: 10, p: 880, r: 'c' },
      high: { l: 16, p: 9000, r: 'c' }
    },
    'sisterstone-dusk': {
      low: { l: 3, p: 70, r: 'r' },
      standard: { l: 11, p: 1200, r: 'r' },
      high: { l: 19, p: 32000, r: 'r' }
    },
    'sisterstone-scarlet': {
      low: { l: 3, p: 70, r: 'r' },
      standard: { l: 11, p: 1200, r: 'r' },
      high: { l: 19, p: 32000, r: 'r' }
    },
    sloughstone: { standard: { l: 8, p: 3500, r: 'r' }, high: { l: 16, p: 6000, r: 'r' } },
    'sovereign-steel': { standard: { l: 12, p: 1600, r: 'r' }, high: { l: 19, p: 32000, r: 'r' } },
    warpglass: { high: { l: 17, p: 14000, r: 'r' } }
  },
  buckler: {
    abysium: { standard: { l: 8, p: 400, r: 'r' }, high: { l: 16, p: 8000, r: 'r' } },
    adamantine: { standard: { l: 8, p: 400, r: 'u' }, high: { l: 16, p: 8000, r: 'u' } },
    'cold-iron': {
      low: { l: 2, p: 30, r: 'c' },
      standard: { l: 7, p: 300, r: 'c' },
      high: { l: 15, p: 5000, r: 'c' }
    },
    dawnsilver: { standard: { l: 8, p: 400, r: 'u' }, high: { l: 16, p: 8000, r: 'u' } },
    djezet: { standard: { l: 9, p: 600, r: 'r' }, high: { l: 16, p: 8000, r: 'r' } },
    duskwood: { standard: { l: 8, p: 400, r: 'u' }, high: { l: 16, p: 8000, r: 'u' } },
    inubrix: { standard: { l: 7, p: 320, r: 'r' }, high: { l: 15, p: 5000, r: 'r' } },
    noqual: { high: { l: 17, p: 14000, r: 'r' } },
    orichalcum: { high: { l: 17, p: 12000, r: 'r' } },
    siccatite: { standard: { l: 8, p: 400, r: 'r' }, high: { l: 16, p: 8000, r: 'r' } },
    silver: {
      low: { l: 2, p: 30, r: 'c' },
      standard: { l: 7, p: 300, r: 'c' },
      high: { l: 15, p: 5000, r: 'c' }
    }
  },
  shield: {
    abysium: { standard: { l: 8, p: 440, r: 'r' }, high: { l: 16, p: 8800, r: 'r' } },
    adamantine: { standard: { l: 8, p: 440, r: 'u' }, high: { l: 16, p: 8800, r: 'u' } },
    'cold-iron': {
      low: { l: 2, p: 34, r: 'c' },
      standard: { l: 7, p: 340, r: 'c' },
      high: { l: 15, p: 5500, r: 'c' }
    },
    dawnsilver: { standard: { l: 8, p: 440, r: 'u' }, high: { l: 16, p: 8800, r: 'u' } },
    djezet: { standard: { l: 9, p: 660, r: 'r' }, high: { l: 16, p: 8800, r: 'r' } },
    duskwood: { standard: { l: 8, p: 440, r: 'u' }, high: { l: 16, p: 8800, r: 'u' } },
    inubrix: { standard: { l: 7, p: 352, r: 'r' }, high: { l: 15, p: 5500, r: 'r' } },
    'keep-stone': { high: { l: 17, p: 13200, r: 'r' } },
    noqual: { high: { l: 17, p: 15400, r: 'r' } },
    orichalcum: { high: { l: 17, p: 13200, r: 'r' } },
    siccatite: { standard: { l: 8, p: 440, r: 'r' }, high: { l: 16, p: 8800, r: 'r' } },
    silver: {
      low: { l: 2, p: 34, r: 'c' },
      standard: { l: 7, p: 340, r: 'c' },
      high: { l: 15, p: 5500, r: 'c' }
    }
  },
  towerShield: {
    duskwood: { standard: { l: 8, p: 560, r: 'u' }, high: { l: 16, p: 11200, r: 'u' } }
  }
}

// Item grades. `c` is credits; PF2e divides by ten to get a gp price.
export const GRADES: Record<string, Record<string, GradeValue>> = {
  weapon: {
    advanced: { l: 4, c: 1000 },
    commercial: { l: 0, c: 0 },
    elite: { l: 12, c: 20000 },
    paragon: { l: 19, c: 400000 },
    superior: { l: 10, c: 10000 },
    tactical: { l: 2, c: 350 },
    ultimate: { l: 16, c: 100000 }
  },
  armor: {
    advanced: { l: 8, c: 5000 },
    commercial: { l: 0, c: 0 },
    elite: { l: 14, c: 45000 },
    paragon: { l: 20, c: 700000 },
    superior: { l: 11, c: 14000 },
    tactical: { l: 5, c: 1600 },
    ultimate: { l: 18, c: 240000 }
  },
  shield: {
    advanced: { l: 8, c: 3000 },
    commercial: { l: 0, c: 0 },
    elite: { l: 14, c: 25000 },
    paragon: { l: 20, c: 320000 },
    superior: { l: 11, c: 9000 },
    tactical: { l: 5, c: 750 },
    ultimate: { l: 18, c: 800000 }
  }
}
