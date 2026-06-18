import { getPath } from '@/utils/utilities'
import { enrichChatHtml } from '@/utils/pf2eEnrich'

const ALLOWED_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'BLOCKQUOTE',
  'BR',
  'BUTTON',
  'CODE',
  'DD',
  'DEL',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'EM',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'I',
  'IMG',
  'LI',
  'OL',
  'P',
  'SECTION',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUMMARY',
  'SUP',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TIME',
  'TR',
  'U',
  'UL'
])

const GLOBAL_ATTRS = new Set(['class', 'title', 'role', 'aria-label', 'aria-hidden', 'aria-busy'])
const TAG_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'target', 'rel']),
  BUTTON: new Set(['type', 'disabled', 'name', 'value']),
  IMG: new Set(['src', 'alt', 'width', 'height', 'loading']),
  TD: new Set(['colspan', 'rowspan']),
  TH: new Set(['colspan', 'rowspan', 'scope']),
  TIME: new Set(['datetime'])
}

function hasSafeUrl(value: string): boolean {
  return /^(?:https?:|\/|#)/i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value)
}

export function normalizeFoundryAssetUrls(html: string | null | undefined): string | undefined {
  if (!html) return undefined
  if (typeof document === 'undefined') return html

  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src')
    if (!src || src.startsWith('#')) return
    img.setAttribute('src', getPath(src))
  })
  return template.innerHTML
}

function isAllowedAttr(element: Element, attr: Attr): boolean {
  const name = attr.name.toLowerCase()
  if (name.startsWith('on')) return false
  if (name.startsWith('data-') || name.startsWith('aria-')) return true
  if (GLOBAL_ATTRS.has(name)) return true

  const tagName = element.tagName
  if (!TAG_ATTRS[tagName]?.has(name)) return false
  if ((name === 'href' || name === 'src') && !hasSafeUrl(attr.value)) return false
  return true
}

function unwrapElement(element: Element) {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
}

export function sanitizeChatHtml(
  html: string | undefined,
  options?: { stripGmContent?: boolean }
): string | undefined {
  if (!html || typeof document === 'undefined') return html

  const template = document.createElement('template')
  template.innerHTML = html

  if (options?.stripGmContent) {
    template.content.querySelectorAll('[data-visibility="gm"]').forEach((el) => el.remove())
  }

  template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(
    (element) => element.remove()
  )

  Array.from(template.content.querySelectorAll('*')).forEach((element) => {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      unwrapElement(element)
      return
    }

    Array.from(element.attributes).forEach((attr) => {
      if (!isAllowedAttr(element, attr)) element.removeAttribute(attr.name)
    })

    if (element.tagName === 'A') {
      const href = element.getAttribute('href')
      if (href && !hasSafeUrl(href)) element.removeAttribute('href')
      if (element.getAttribute('target') === '_blank') element.setAttribute('rel', 'noreferrer')
    }
  })

  return template.innerHTML
}

export function prepareChatHtml(
  html: string | null | undefined,
  options?: { stripGmContent?: boolean }
): string | undefined {
  const normalized = normalizeFoundryAssetUrls(html)
  return sanitizeChatHtml(normalized ? enrichChatHtml(normalized) : normalized, options)
}
