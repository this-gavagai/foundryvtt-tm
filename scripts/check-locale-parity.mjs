#!/usr/bin/env node
/**
 * Locale lint.
 *
 * The i18n catalogs in src/locales/*.json are auto-discovered (see
 * src/plugins/i18n.ts): dropping a file in there makes its language load, and
 * en.json is the reference every other catalog falls back to. That only works
 * if the other catalogs stay complete — plain JSON silently accepts a missing
 * key (the string falls back to English) or an interpolation placeholder that
 * was dropped or misspelled in translation (the value renders with a literal
 * {name} or an empty slot). Historically the non-English catalogs drifted:
 * es.json shipped 47 keys behind en.json, de.json 10, ru.json 6.
 *
 * Fails when a non-reference catalog:
 *   1. is missing a key en.json defines, or defines a key en.json doesn't
 *      (a typo, or a stale key left after an en.json rename),
 *   2. types a value differently from en.json (string vs nested object),
 *   3. drops or adds an interpolation placeholder relative to en.json — the
 *      set of {tokens} in a translated string must match its English source
 *      exactly, so no message renders with a broken or literal placeholder.
 *
 * Run: node scripts/check-locale-parity.mjs   (also wired into `npm run build`)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = 'src/locales'
const REFERENCE = 'en'

let failed = false
const report = (msg) => {
  failed = true
  console.error(`✗ ${msg}`)
}

const load = (file) => JSON.parse(readFileSync(join(root, dir, file), 'utf8'))

/** Flatten to dotted-path → value, so a string vs nested-object mismatch at
 * any depth surfaces as a leaf difference rather than passing silently. */
function flatten(obj, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix + key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path + '.'))
    } else {
      out[path] = value
    }
  }
  return out
}

/** Interpolation placeholders in a vue-i18n message: {name}, {count}, … */
function placeholders(value) {
  if (typeof value !== 'string') return new Set()
  return new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
}

const catalogFiles = readdirSync(join(root, dir)).filter((f) => f.endsWith('.json'))
const referenceFile = `${REFERENCE}.json`
if (!catalogFiles.includes(referenceFile)) {
  report(`no reference catalog ${dir}/${referenceFile}`)
  process.exit(1)
}

const reference = flatten(load(referenceFile))
const referenceKeys = Object.keys(reference)
const others = catalogFiles.filter((f) => f !== referenceFile)

for (const file of others) {
  const catalog = flatten(load(file))
  const keys = new Set(Object.keys(catalog))

  for (const key of referenceKeys) {
    if (!keys.has(key)) {
      report(`${dir}/${file}: missing key "${key}" (in ${referenceFile})`)
      continue
    }
    const refIsString = typeof reference[key] === 'string'
    const hasIsString = typeof catalog[key] === 'string'
    if (refIsString !== hasIsString) {
      report(`${dir}/${file}: key "${key}" has a different value type than ${referenceFile}`)
      continue
    }
    if (refIsString) {
      const refP = placeholders(reference[key])
      const hasP = placeholders(catalog[key])
      for (const p of refP) {
        if (!hasP.has(p))
          report(`${dir}/${file}: key "${key}" is missing placeholder {${p}} present in English`)
      }
      for (const p of hasP) {
        if (!refP.has(p))
          report(`${dir}/${file}: key "${key}" has stray placeholder {${p}} not in English`)
      }
    }
  }

  for (const key of keys) {
    if (!(key in reference)) report(`${dir}/${file}: extra key "${key}" not in ${referenceFile}`)
  }
}

if (failed) {
  console.error(`\nLocale catalogs have drifted from ${dir}/${referenceFile}.`)
  process.exit(1)
}
console.log(
  `✓ locales: ${others.map((f) => f.replace('.json', '')).join(', ')} ` +
    `in parity with ${REFERENCE} (${referenceKeys.length} keys)`
)
