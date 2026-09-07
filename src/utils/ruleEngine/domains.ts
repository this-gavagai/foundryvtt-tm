// Which domains a statistic listens on.
//
// A FlatModifier names `selector`s; a statistic collects every modifier whose
// selector matches one of ITS domains. Getting a domain list wrong makes a
// modifier vanish or attach to the wrong number, and nothing about the result
// looks unusual — so the lists live here, in one table, copied from pf2e 8.4.1's
// own statistic construction rather than inferred.
//
//   saves       [slug, `${attribute}-based`, 'saving-throw', 'all']
//   skills      [slug, `${attribute}-based`, 'skill-check', `${attribute}-skill-check`, 'all']
//   lore        [slug, 'skill-check', 'lore-skill-check', 'int-skill-check', 'all']
//   AC          ['all', 'ac', 'dex-based']
//   perception  ['perception', 'all', 'wis-based']

export const SAVE_ATTRIBUTES: Record<string, string> = {
  fortitude: 'con',
  reflex: 'dex',
  will: 'wis'
}

export function saveDomains(slug: string, attribute = SAVE_ATTRIBUTES[slug] ?? 'con'): string[] {
  return [slug, `${attribute}-based`, 'saving-throw', 'all']
}

export function skillDomains(slug: string, attribute: string): string[] {
  return [slug, `${attribute}-based`, 'skill-check', `${attribute}-skill-check`, 'all']
}

export function loreDomains(slug: string): string[] {
  return [slug, 'skill-check', 'lore-skill-check', 'int-skill-check', 'all']
}

export const AC_DOMAINS = ['all', 'ac', 'dex-based']
export const PERCEPTION_DOMAINS = ['perception', 'all', 'wis-based']

// Added to whichever statistic rolls initiative, rather than collected on its
// own. PF2e clones the named statistic with this domain appended, so an
// initiative modifier contests against the statistic's own — see
// `deriveInitiative`.
export const INITIATIVE_DOMAINS = ['initiative']
