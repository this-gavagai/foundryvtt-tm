// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeChatHtml } from '@/utils/chatHtml'
import { applyPf2eNotation } from '@/utils/pf2eEnrich'

// sanitizeChatHtml guards every v-html sink in the app: chat messages (via
// prepareChatHtml) and item/spell/feat descriptions (ParsedDescription
// sanitizes its source text before enrichment). These tests pin the XSS
// contract — a regression here re-opens script execution from world content.

const clean = (html: string, options?: { stripGmContent?: boolean }) =>
  sanitizeChatHtml(html, options) ?? ''

describe('sanitizeChatHtml — script and active-content removal', () => {
  it('removes script elements entirely, keeping surrounding content', () => {
    const out = clean('<p>before</p><script>alert(1)</script><p>after</p>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('<p>before</p>')
    expect(out).toContain('<p>after</p>')
  })

  it('removes script elements smuggled inside unwrapped foreign content (svg)', () => {
    const out = clean('<svg><script>alert(1)</script></svg>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<svg')
  })

  it.each(['style', 'iframe', 'object', 'embed', 'link', 'meta'])(
    'removes <%s> elements',
    (tag) => {
      const out = clean(`<p>ok</p><${tag} src="https://evil.example"></${tag}>`)
      expect(out).not.toContain(`<${tag}`)
      expect(out).toContain('<p>ok</p>')
    }
  )

  it('strips every on* event handler attribute', () => {
    const out = clean(
      '<img src="/icons/a.webp" onerror="alert(1)"><div onclick="alert(2)">x</div>' +
        '<a href="https://a.example" onmouseover="alert(3)">y</a>'
    )
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('onmouseover')
    expect(out).not.toContain('alert')
  })

  it('unwraps disallowed tags but preserves their text content', () => {
    const out = clean('<video controls>fallback text</video><blink>note</blink>')
    expect(out).not.toContain('<video')
    expect(out).not.toContain('<blink')
    expect(out).toContain('fallback text')
    expect(out).toContain('note')
  })
})

describe('sanitizeChatHtml — URL scheme filtering', () => {
  it('removes javascript: hrefs', () => {
    const out = clean('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toContain('javascript:')
  })

  it('removes javascript: hrefs disguised with case, whitespace, or control chars', () => {
    // Browsers strip C0 controls/spaces when parsing URLs, so all of these execute.
    const disguises = [
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      '\tjavascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      '\u0001javascript:alert(1)'
    ]
    for (const href of disguises) {
      const out = clean(`<a href="${href}">x</a>`)
      expect(out).not.toContain('alert(1)')
    }
  })

  it('removes non-web schemes from img src (javascript:, data:)', () => {
    const out = clean(
      '<img src="javascript:alert(1)"><img src="data:text/html,<script>alert(1)</script>">'
    )
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('data:')
  })

  it('keeps https, root-relative, fragment, and schemeless URLs', () => {
    const out = clean(
      '<a href="https://example.com">a</a><a href="/local/path">b</a>' +
        '<a href="#anchor">c</a><img src="icons/relative.webp">'
    )
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('href="/local/path"')
    expect(out).toContain('href="#anchor"')
    expect(out).toContain('src="icons/relative.webp"')
  })

  it('forces rel=noreferrer on target=_blank links', () => {
    const out = clean('<a href="https://example.com" target="_blank">x</a>')
    expect(out).toContain('rel="noreferrer"')
  })
})

describe('sanitizeChatHtml — attribute allowlist', () => {
  it('keeps data-* and aria-* attributes and the global allowlist', () => {
    const out = clean(
      '<span data-pf2-action="grapple" aria-label="Grapple" class="tag" title="t">x</span>'
    )
    expect(out).toContain('data-pf2-action="grapple"')
    expect(out).toContain('aria-label="Grapple"')
    expect(out).toContain('class="tag"')
    expect(out).toContain('title="t"')
  })

  it('drops attributes outside the allowlist', () => {
    const out = clean('<p style="position:fixed" id="x" contenteditable>y</p>')
    expect(out).not.toContain('style=')
    expect(out).not.toContain('id=')
    expect(out).not.toContain('contenteditable')
  })
})

describe('sanitizeChatHtml — Foundry content survives', () => {
  // ParsedDescription sanitizes raw description HTML *before* enrichment and
  // roll-input injection, so the enricher's click targets must pass through.
  it('preserves pre-enriched PF2e markup shapes', () => {
    const out = clean(
      '<a class="content-link" data-uuid="Compendium.pf2e.spells-srd.Item.abc">Fireball</a>' +
        '<a class="inline-check" data-pf2-check="reflex" data-pf2-dc="20">Reflex</a>' +
        '<span data-pf2-action="trip" data-pf2-glyph="1">Trip</span>'
    )
    expect(out).toContain('data-uuid="Compendium.pf2e.spells-srd.Item.abc"')
    expect(out).toContain('data-pf2-check="reflex"')
    expect(out).toContain('data-pf2-dc="20"')
    expect(out).toContain('data-pf2-action="trip"')
  })

  it('leaves PF2e text notation intact for post-sanitize enrichment', () => {
    // ParsedDescription runs applyPf2eNotation on the sanitizer's output, so
    // notation must survive the DOM parse/serialize round-trip.
    const raw =
      '<p>Make a @Check[reflex|dc:20] save or take @Damage[2d6[fire]].</p>' +
      '<script>alert(1)</script>'
    const sanitized = clean(raw)
    expect(sanitized).toContain('@Check[reflex|dc:20]')
    expect(sanitized).toContain('@Damage[2d6[fire]]')
    expect(sanitized).not.toContain('<script')
    const enriched = applyPf2eNotation(sanitized, {
      check: (slug, _inline, dc) =>
        `<a class="inline-check" data-pf2-check="${slug}" data-pf2-dc="${dc}">${slug}</a>`,
      damage: (formula) => `<a class="inline-roll">${formula}</a>`
    })
    expect(enriched).toContain('data-pf2-check="reflex"')
    expect(enriched).toContain('data-pf2-dc="20"')
    expect(enriched).not.toContain('@Check')
    expect(enriched).not.toContain('@Damage')
  })

  it('preserves typical description structure (headings, lists, tables, hr)', () => {
    const html =
      '<h2>Effect</h2><hr><ul><li>one</li></ul>' +
      '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>'
    expect(clean(html)).toBe(html)
  })
})

describe('sanitizeChatHtml — options and edge cases', () => {
  it('removes GM-only blocks when stripGmContent is set, keeps them otherwise', () => {
    const html = '<p>public</p><div data-visibility="gm">secret</div>'
    expect(clean(html, { stripGmContent: true })).not.toContain('secret')
    expect(clean(html)).toContain('secret')
  })

  it('passes undefined and empty input through', () => {
    expect(sanitizeChatHtml(undefined)).toBeUndefined()
    expect(sanitizeChatHtml('')).toBe('')
  })
})
