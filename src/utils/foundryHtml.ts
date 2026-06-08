import type { ActiveRoll } from '@/types/api-types'
import { getPath } from '@/utils/utilities'
import { enrichChatHtml } from '@/utils/pf2eEnrich'
import { PF2E_ACTION_STAT_MAP } from '@/utils/constants'

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

function paramsFromString(params: string | undefined): Record<string, string> | undefined {
  if (!params) return undefined
  const parsed = params
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((out, part) => {
      const [key, ...rest] = part.split('=')
      if (key && rest.length) out[key] = rest.join('=')
      return out
    }, {})
  return Object.keys(parsed).length ? parsed : undefined
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

function checkInlineFromAnchor(anchor: HTMLAnchorElement): Record<string, string | true> {
  const inline: Record<string, string | true> = {}
  if (anchor.dataset.pf2Traits) inline.traits = anchor.dataset.pf2Traits
  if (anchor.dataset.pf2RollOptions) inline.options = anchor.dataset.pf2RollOptions
  if (anchor.dataset.pf2RepostFlavor) inline.name = anchor.dataset.pf2RepostFlavor
  if (anchor.dataset.pf2Roller) inline.roller = anchor.dataset.pf2Roller
  if (anchor.dataset.rollerRole) inline.rollerRole = anchor.dataset.rollerRole
  if (anchor.dataset.pf2Dc) inline.dc = anchor.dataset.pf2Dc
  if (anchor.dataset.pf2ShowDc) inline.showDC = anchor.dataset.pf2ShowDc
  if (anchor.dataset.pf2Adjustment) inline.adjustment = anchor.dataset.pf2Adjustment
  if ('overrideTraits' in anchor.dataset) inline.overrideTraits = true
  if ('targetOwner' in anchor.dataset) inline.targetOwner = true
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
  Object.assign(params, paramsFromString(element.dataset.pf2ParamsString))
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

export function activeRollFromInlineCheckAnchor(anchor: HTMLAnchorElement): ActiveRoll | undefined {
  const slug = anchor.dataset.pf2Check
  if (!slug) return undefined
  const inline = checkInlineFromAnchor(anchor)
  const dc =
    typeof inline.dc === 'string' && /^\d+$/.test(inline.dc) ? Number(inline.dc) : undefined
  const against = anchor.dataset.against
  return {
    action: 'check',
    slug,
    label: anchor.textContent?.trim() || slug,
    checkInline: Object.keys(inline).length ? inline : undefined,
    dc,
    against
  }
}

export function activeRollFromFoundryClickTarget(target: HTMLElement): ActiveRoll | undefined {
  const actionElement = target.closest<HTMLElement>('[data-pf2-action]')
  const actionRoll = actionElement ? activeRollFromActionElement(actionElement) : undefined
  if (actionRoll) return actionRoll

  const inlineCheck = target.closest<HTMLAnchorElement>('a.inline-check[data-pf2-check]')
  const checkRoll = inlineCheck ? activeRollFromInlineCheckAnchor(inlineCheck) : undefined
  if (checkRoll) return checkRoll

  const inlineRoll = target.closest<HTMLAnchorElement>('a.inline-roll')
  return inlineRoll ? activeRollFromInlineRollAnchor(inlineRoll) : undefined
}
