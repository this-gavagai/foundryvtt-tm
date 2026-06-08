// Split a string on `|` only at bracket-depth zero — used to peel pipe-
// separated annotations off inline-roll payloads without splitting inside
// bracketed type tags whose own contents may contain `|`.
export function splitOnTopLevelPipe(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '[') depth++
    else if (c === ']') depth--
    else if (c === '|' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

// Parse pipe-separated annotations from an @Damage or similar payload.
// A segment with a colon is a key:value pair; a bare segment is a boolean flag.
export function parseDamageInlineParams(segments: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) out[trimmed] = true
    else out[trimmed.slice(0, colonIdx).trim()] = trimmed.slice(colonIdx + 1)
  }
  return out
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value)
}

function htmlAttr(name: string, value: string | true | undefined): string {
  if (value === undefined) return ''
  return value === true ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`
}

function paramsRecord(params: string): Record<string, string> {
  return params
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((out, part) => {
      const [key, ...rest] = part.split('=')
      if (key && rest.length) out[key] = rest.join('=')
      return out
    }, {})
}

export interface Pf2eNotationReplacers {
  // [[/act slug params]]{label}
  action?: (slug: string, params: string, label: string | undefined) => string
  // @Check[type|key:val|flag]
  check?: (
    slug: string,
    inline: Record<string, string | true>,
    dc: number | undefined,
    against: string | undefined
  ) => string
  // @UUID[uuid]{label}  /  @Compendium[uuid]{label}
  uuid?: (uuid: string, label: string) => string
  // @Damage[formula|annotations]{label}
  damage?: (
    formula: string,
    damageInline: Record<string, string | true>,
    label: string | undefined
  ) => string
  // [[/r formula]]
  inlineRoll?: (formula: string) => string
}

// Apply PF2e's text-based notation patterns to `text`, delegating each match
// to the corresponding replacer. Unrecognised or omitted replacers are left
// unchanged. Safe to run on mixed content — the patterns only match
// un-enriched notation; PF2e's enricher replaces them before storage when it
// has already processed the text.
export function applyPf2eNotation(
  text: string | undefined,
  replacers: Pf2eNotationReplacers
): string | undefined {
  if (!text) return text

  // [[/act slug params]]{label}
  if (replacers.action) {
    text = text.replace(
      /\[\[\/act (?<slug>[^\s\]]+)[\s]*(?<params>.*?)\]\](\{(?<label>.+?)\})?/gm,
      (...args) => {
        const g = args[args.length - 1] as { slug?: string; params?: string; label?: string }
        return replacers.action!(g.slug ?? '', g.params ?? '', g.label)
      }
    )
  }

  // @Check[type|annotations]
  if (replacers.check) {
    text = text.replace(/@Check\[((?:[^\[\]]|\[[^\]]*\])*)\]/gm, (_, content: string) => {
      const parts = splitOnTopLevelPipe(content)
      const slug = parts[0]
      const inline = parseDamageInlineParams(parts.slice(1))
      const dc =
        typeof inline.dc === 'string' && /^\d+$/.test(inline.dc) ? Number(inline.dc) : undefined
      const against = typeof inline.against === 'string' ? inline.against : undefined
      return replacers.check!(slug, inline, dc, against)
    })
  }

  // @UUID[uuid]{label}  /  @Compendium[uuid]{label}
  if (replacers.uuid) {
    text = text.replace(
      /@(?:UUID|Compendium)\[([^\]]+)\]\{([^}]*)\}/gm,
      (_, uuid: string, label: string) => replacers.uuid!(uuid, label)
    )
  }

  // @Damage[formula|annotations]{label}
  if (replacers.damage) {
    text = text.replace(
      /@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/gm,
      (_, content: string, label: string | undefined) => {
        const segments = splitOnTopLevelPipe(content)
        const formula = segments[0] ?? ''
        const damageInline = parseDamageInlineParams(segments.slice(1))
        return replacers.damage!(formula, damageInline, label)
      }
    )
  }

  // [[/r formula]]
  if (replacers.inlineRoll) {
    text = text.replace(/\[\[\/r ([^\]]*)\]\]/gm, (_, formula: string) =>
      replacers.inlineRoll!(formula)
    )
  }

  return text
}

// Maps @Damage inline param keys to their corresponding data-* attribute names
// as produced by PF2e's enricher.
const DAMAGE_ATTR_NAMES: Record<string, string> = {
  traits: 'traits',
  options: 'roll-options',
  domains: 'domains',
  name: 'name',
  flavor: 'flavor',
  immutable: 'immutable',
  overrideTraits: 'override-traits'
}

const CHECK_ATTR_NAMES: Record<string, string> = {
  traits: 'pf2-traits',
  options: 'pf2-roll-options',
  name: 'pf2-repost-flavor',
  roller: 'pf2-roller',
  rollerRole: 'roller-role',
  dc: 'pf2-dc',
  showDC: 'pf2-show-dc',
  adjustment: 'pf2-adjustment',
  overrideTraits: 'override-traits',
  targetOwner: 'target-owner'
}

function inlineAttrs(
  inline: Record<string, string | true>,
  attrNames: Record<string, string>
): string {
  return Object.entries(inline)
    .filter(([key]) => key in attrNames)
    .map(([key, value]) => htmlAttr(`data-${attrNames[key]}`, value))
    .join('')
}

export function pf2eActionHtml({
  slug,
  params,
  label,
  content
}: {
  slug: string
  params?: string
  label?: string
  content?: string
}): string {
  const parsedParams = params ? paramsRecord(params) : {}
  const body = content ?? `<span class="pf2-icon-inline">1</span>${escapeHtml(label ?? slug)}`
  return `<a role="button" data-pf2-action="${escapeAttr(slug)}"${htmlAttr(
    'data-pf2-params-string',
    params || undefined
  )}${htmlAttr('data-pf2-variant', parsedParams.variant)}${htmlAttr(
    'data-pf2-stat',
    parsedParams.statistic ?? parsedParams.stat
  )}${htmlAttr('data-pf2-skill', parsedParams.skill)}>${body}</a>`
}

export function pf2eCheckHtml({
  slug,
  inline,
  dc,
  against,
  label,
  content
}: {
  slug: string
  inline?: Record<string, string | true>
  dc?: number
  against?: string
  label?: string
  content?: string
}): string {
  const display = label ?? (typeof inline?.name === 'string' ? inline.name : undefined) ?? slug
  const dcSuffix = dc ? ` DC ${dc}` : against ? ` vs ${against}` : ''
  const body = content ?? `${escapeHtml(display)} Check${escapeHtml(dcSuffix)}`
  return `<a class="inline-check" data-pf2-check="${escapeAttr(slug)}"${htmlAttr(
    'data-against',
    against
  )}${inlineAttrs(inline ?? {}, CHECK_ATTR_NAMES)}>${body}</a>`
}

export function pf2eUuidHtml(uuid: string, label: string): string {
  return `<a class="content-link" data-uuid="${escapeAttr(uuid)}" data-type="Item">${escapeHtml(
    label
  )}</a>`
}

export function pf2eDamageHtml(
  formula: string,
  damageInline: Record<string, string | true>,
  label: string | undefined,
  content?: string
): string {
  const display = content ?? escapeHtml(label ?? formula.replace(/\[([^\]]*)\]/g, ' $1').trim())
  return `<a class="inline-roll" data-damage-roll="${escapeAttr(formula)}"${inlineAttrs(
    damageInline,
    DAMAGE_ATTR_NAMES
  )}>${display}</a>`
}

// Convert un-enriched PF2e notation inside a raw chat HTML blob to elements
// that ChatOverlay.vue's existing click handlers can work with:
//   @UUID[...]/{label}  →  <a class="content-link" data-uuid="…" data-type="Item">
//   [[/act ...]]        →  <a data-pf2-action="…">
//   @Check[...]         →  <a class="inline-check" data-pf2-check="…">
//   @Damage[formula]    →  <a class="inline-roll" data-damage-roll="…">
//   [[/r formula]]      →  <span class="text-green-900">…</span>
export function enrichChatHtml(html: string): string {
  return applyPf2eNotation(html, {
    action: (slug, params, label) => pf2eActionHtml({ slug, params, label }),

    check: (slug, inline, dc, against) => pf2eCheckHtml({ slug, inline, dc, against }),

    uuid: pf2eUuidHtml,

    damage: pf2eDamageHtml,

    inlineRoll: (formula) => `<span class="text-green-900">${escapeHtml(formula)}</span>`
  }) as string
}
