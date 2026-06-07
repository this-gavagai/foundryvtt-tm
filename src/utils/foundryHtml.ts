import type { ActiveRoll } from '@/types/api-types'
import { getPath } from '@/utils/utilities'
import { enrichChatHtml } from '@/utils/pf2eEnrich'

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

export function normalizeFoundryAssetUrls(html: string | null | undefined): string | undefined {
  if (!html) return undefined
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src')
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return
    img.setAttribute('src', getPath(src))
  })
  return template.innerHTML
}

export function prepareChatHtml(html: string | null | undefined): string | undefined {
  const normalized = normalizeFoundryAssetUrls(html)
  return normalized ? enrichChatHtml(normalized) : normalized
}

export function compendiumUuidFromClickTarget(target: HTMLElement): string | undefined {
  return (
    target.closest<HTMLElement>('[data-type="compendiumLink"]')?.dataset.uuid ??
    target.closest<HTMLAnchorElement>('a.content-link[data-uuid]')?.dataset.uuid
  )
}

function isItemContentLink(anchor: HTMLAnchorElement): boolean {
  return anchor.dataset.type?.toLowerCase() === 'item' || /\.Item\./.test(anchor.dataset.uuid ?? '')
}

export function compendiumItemUuidFromClickTarget(target: HTMLElement): string | undefined {
  const contentLink = target.closest<HTMLAnchorElement>('a.content-link[data-uuid]')
  if (!contentLink || !isItemContentLink(contentLink)) return undefined
  return contentLink.dataset.uuid
}

function normalizeInlineFormula(formula: string): string {
  const trimmed = formula.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed.slice(1, -1)
  return trimmed
}

function damageInlineFromAnchor(anchor: HTMLAnchorElement): Record<string, string | true> {
  const inline: Record<string, string | true> = {}
  if (anchor.dataset.traits) inline.traits = anchor.dataset.traits
  if (anchor.dataset.rollOptions) inline.options = anchor.dataset.rollOptions
  if (anchor.dataset.domains) inline.domains = anchor.dataset.domains
  if (anchor.dataset.name) inline.name = anchor.dataset.name
  else if (anchor.dataset.flavor) inline.name = anchor.dataset.flavor
  if ('immutable' in anchor.dataset) inline.immutable = true
  if ('overrideTraits' in anchor.dataset) inline.overrideTraits = true
  return inline
}

export function activeRollFromInlineRollAnchor(anchor: HTMLAnchorElement): ActiveRoll | undefined {
  if (!('damageRoll' in anchor.dataset)) return undefined
  const rawFormula =
    anchor.dataset.damageRoll || anchor.dataset.baseFormula || anchor.dataset.formula || ''
  const formula = normalizeInlineFormula(rawFormula)
  if (!formula) return undefined
  const damageInline = damageInlineFromAnchor(anchor)
  return {
    action: 'damage',
    formula,
    label: anchor.textContent?.trim() || formula,
    itemId: anchor.dataset.itemId,
    damageInline: Object.keys(damageInline).length ? damageInline : undefined
  }
}

export function activeRollFromActionElement(element: HTMLElement): ActiveRoll | undefined {
  const slug = element.dataset.pf2Action
  if (!slug) return undefined
  const label =
    element.querySelector<HTMLElement>(':scope > span')?.textContent?.trim() ||
    element.textContent?.trim() ||
    slug
  const params: Record<string, string> = {}
  if (element.dataset.pf2Variant) params.variant = element.dataset.pf2Variant
  const statisticSlug =
    element.dataset.pf2Stat || element.dataset.pf2Skill || PF2E_ACTION_STAT_MAP[slug] || undefined
  return {
    action: 'action',
    slug,
    label,
    statisticSlug,
    params: Object.keys(params).length ? params : undefined
  }
}

export function activeRollFromFoundryClickTarget(target: HTMLElement): ActiveRoll | undefined {
  const actionElement = target.closest<HTMLElement>('[data-pf2-action]')
  const actionRoll = actionElement ? activeRollFromActionElement(actionElement) : undefined
  if (actionRoll) return actionRoll

  const inlineRoll = target.closest<HTMLAnchorElement>('a.inline-roll')
  return inlineRoll ? activeRollFromInlineRollAnchor(inlineRoll) : undefined
}
