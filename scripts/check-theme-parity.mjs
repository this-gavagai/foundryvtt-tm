#!/usr/bin/env node
/**
 * Theme lint.
 *
 * Containment declares inheritance (see src/themes/index.ts): a root folder
 * holding _<name>.css is an abstract base — structure plus a neutral default
 * for every token, never itself a theme (the underscore FILE marks the
 * partial; core/_core.css today) — and the theme folders inside it are
 * palette-only files over it. The arrangement only holds if those palettes stay complete
 * and in step with each other — plain CSS would silently accept a missing
 * rule or a misspelled token. Historically the palettes were mirrored by
 * hand and drifted (sunny shipped without moonlit's character-option and
 * damage-clear-all rules).
 *
 * Fails when:
 *   1. a selector path (including @media context) or a token exists in one
 *      inheriting palette but not another, or
 *   2. the base breaks its contract: a rule scoped to anything but its own
 *      body.base-<x> marker class (the base must not name its inheritors), a
 *      fallback-less token its own block doesn't default (an inheriting
 *      theme that misses a token must degrade gracefully, not render
 *      broken), or a variants/ folder (a variant of an unselectable base
 *      could never apply), or
 *   3. a variant file (…/<theme>/variants/*.css) breaks the variant
 *      contract: rules scoped to body.theme-<parent>.variant-<name>,
 *      custom-property declarations only, and only token names the parent
 *      theme already defines, or
 *   4. a .css sits outside the layout — themes own a folder
 *      (<name>/<name>.css, assets beside it, variants under
 *      <name>/variants/), inside a base's folder or at the themes root;
 *      nothing lives loose.
 *
 * Run: node scripts/check-theme-parity.mjs   (also wired into `npm run build`)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Tokens deliberately not declared by every palette. Every entry must be
// consumed with a var() fallback (verified below); list the reason here.
const ASYMMETRIC_TOKENS = new Set([
  // sunny pins its wash with background-attachment: fixed; moonlit scrolls.
  '--tm-backdrop-attachment'
])

// Custom properties set at runtime / by other rules rather than declared as
// theme tokens.
const DYNAMIC_VARS = new Set(['--proficiency-color', '--section-color', '--tw-ring-color'])

let failed = false
const report = (msg) => {
  failed = true
  console.error(`✗ ${msg}`)
}

const parse = (file) => postcss.parse(readFileSync(join(root, file), 'utf8'), { from: file })

const normalize = (selector) =>
  selector
    .replace(/\.theme-[a-z0-9-]+/g, '.theme-*')
    .replace(/\s+/g, ' ')
    .trim()

/** Full selector path of a rule, including nesting and at-rule context. */
function pathOf(node) {
  const parts = []
  for (let n = node; n && n.type !== 'root'; n = n.parent) {
    if (n.type === 'rule') parts.unshift(normalize(n.selector))
    else if (n.type === 'atrule') parts.unshift(`@${n.name} ${n.params}`.trim())
  }
  return parts.join(' >> ')
}

/** Selector paths (rules that carry declarations) + declared token names. */
function collect(file) {
  const selectors = new Set()
  const tokens = new Set()
  parse(file).walkRules((rule) => {
    if (!rule.some((n) => n.type === 'decl')) return
    selectors.add(pathOf(rule))
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--') && decl.parent === rule) tokens.add(decl.prop)
    })
  })
  return { selectors, tokens }
}

/** var(--x) references that have no fallback value. */
function varRefsWithoutFallback(file) {
  const refs = new Set()
  parse(file).walkDecls((decl) => {
    for (const [, name, rest] of decl.value.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      if (rest === ')') refs.add(name)
    }
  })
  return refs
}

const dirsIn = (dir) =>
  readdirSync(join(root, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
const cssIn = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.css'))

// --- discovery: containment is the declaration -------------------------------
// A root folder's stylesheet classifies it: _<name>.css → an abstract base
// whose theme subfolders inherit it; <name>.css → a standalone theme.
const rootDirs = dirsIn('src/themes')
for (const d of rootDirs) {
  const files = cssIn(`src/themes/${d}`)
  if (files.includes(`_${d}.css`) && files.includes(`${d}.css`))
    report(
      `src/themes/${d}: has both _${d}.css and ${d}.css — a folder is a base or a theme, not both`
    )
  if (!files.includes(`_${d}.css`) && !files.includes(`${d}.css`))
    report(`src/themes/${d}: has neither _${d}.css (base) nor ${d}.css (theme)`)
}
const bases = rootDirs
  .filter((d) => cssIn(`src/themes/${d}`).includes(`_${d}.css`))
  .map((name) => ({
    dir: `src/themes/${name}`,
    name,
    file: `src/themes/${name}/_${name}.css`,
    themes: dirsIn(`src/themes/${name}`)
      .filter((d) => d !== 'variants')
      .map((theme) => ({
        name: theme,
        dir: `src/themes/${name}/${theme}`,
        file: `src/themes/${name}/${theme}/${theme}.css`
      }))
  }))
const standalone = rootDirs
  .filter((d) => cssIn(`src/themes/${d}`).includes(`${d}.css`))
  .map((name) => ({ name, dir: `src/themes/${name}`, file: `src/themes/${name}/${name}.css` }))
const allThemes = [...bases.flatMap((b) => b.themes), ...standalone].map((t) => ({
  ...t,
  ...collect(t.file)
}))

if (!bases.length && !standalone.length) report('no themes found under src/themes')

// 1: pairwise selector-path and token diffs among each base's inheritors.
const parityPairs = []
for (const base of bases) {
  const siblings = allThemes.filter((t) => t.dir.startsWith(`${base.dir}/`))
  const [reference, ...others] = siblings
  for (const other of others) {
    parityPairs.push(`${reference.name} ↔ ${other.name}`)
    for (const [kind, key] of [
      ['selector', 'selectors'],
      ['token', 'tokens']
    ]) {
      for (const item of reference[key]) {
        if (!other[key].has(item) && !(kind === 'token' && ASYMMETRIC_TOKENS.has(item)))
          report(`${kind} in ${reference.file} missing from ${other.file}:\n    ${item}`)
      }
      for (const item of other[key]) {
        if (!reference[key].has(item) && !(kind === 'token' && ASYMMETRIC_TOKENS.has(item)))
          report(`${kind} in ${other.file} missing from ${reference.file}:\n    ${item}`)
      }
    }
  }
}

// 2: base contract — scoped only to its own marker class, every consumed
// token defaulted in its own block, no variants, nothing loose in its folder.
for (const base of bases) {
  const tokens = collect(base.file).tokens
  parse(base.file).walkRules((rule) => {
    if (!rule.some((n) => n.type === 'decl')) return
    for (let n = rule.parent; n && n.type !== 'root'; n = n.parent) {
      if (n.type === 'rule') return // nested rules inherit the outer scope
    }
    for (const sel of rule.selectors) {
      if (sel.replace(/\s+/g, ' ').trim() !== `body.base-${base.name}`)
        report(
          `${base.file}: rule "${sel}" must be scoped to exactly "body.base-${base.name}" — ` +
            `the base names no themes; inheritance is declared by containment`
        )
    }
  })
  for (const ref of varRefsWithoutFallback(base.file)) {
    if (DYNAMIC_VARS.has(ref)) continue
    if (!tokens.has(ref))
      report(
        `${base.file} uses var(${ref}) with no fallback but never defaults it in its own block`
      )
    if (ASYMMETRIC_TOKENS.has(ref))
      report(`asymmetric token ${ref} is consumed in ${base.file} without a fallback`)
  }
  if (dirsIn(base.dir).includes('variants'))
    report(`${base.dir}/variants: the abstract base cannot have variants (never selectable)`)
  for (const f of cssIn(base.dir)) {
    if (f !== `_${base.name}.css`)
      report(`${base.dir}/${f}: themes own a folder (<name>/<name>.css); move it there`)
  }
}

// 3: variant contract for every .css under a theme's variants/ folder (the
// location determines the parent: …/moonlit/variants/coolblue.css → moonlit).
const variants = allThemes.flatMap((parent) => {
  let files = []
  try {
    files = cssIn(`${parent.dir}/variants`)
  } catch {
    return []
  }
  return files.map((f) => ({ name: basename(f, '.css'), parent }))
})
for (const { name, parent } of variants) {
  const file = `${parent.dir}/variants/${name}.css`
  const scope = `body.theme-${parent.name}.variant-${name}`
  parse(file).walkRules((rule) => {
    if (!rule.some((n) => n.type === 'decl')) return
    for (const sel of rule.selectors) {
      if (sel.replace(/\s+/g, ' ').trim() !== scope) {
        report(`${file}: rule "${sel}" must be scoped to exactly "${scope}"`)
        return
      }
    }
    rule.walkDecls((decl) => {
      if (!decl.prop.startsWith('--'))
        report(
          `${file}: "${decl.prop}" is not a token — variants are token-only; ` +
            `make the parent theme's rule consume a token instead`
        )
      else if (!parent.tokens.has(decl.prop) && !ASYMMETRIC_TOKENS.has(decl.prop))
        report(`${file}: token ${decl.prop} is not declared by ${parent.file} (typo?)`)
    })
  })
}

// 4: layout — nothing loose at the themes root, and inside a theme's folder
// the only stylesheets are its own file and variants/*.css; anything else is
// outside the convention (and likely never imported or linted).
for (const f of cssIn('src/themes')) {
  report(`src/themes/${f}: themes own a folder (<name>/<name>.css); move it there`)
}
for (const theme of allThemes) {
  for (const f of cssIn(theme.dir)) {
    if (f !== `${theme.name}.css`)
      report(`${theme.dir}/${f}: variants belong in ${theme.dir}/variants/`)
  }
}

if (failed) {
  console.error(
    '\nTheme files have drifted — see the src/themes/core/_core.css header for the contract.'
  )
  process.exit(1)
}
console.log(
  `✓ themes: ${parityPairs.join(', ')} in parity` +
    (variants.length
      ? `; ${variants.map((v) => `${v.parent.name}/${v.name}`).join(', ')} token-only`
      : '')
)
