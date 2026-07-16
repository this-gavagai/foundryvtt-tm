/**
 * Theme discovery. The filesystem is the registry, and containment is the
 * inheritance declaration:
 *
 *   src/themes/<base>/_<base>.css          — an abstract base: loaded, never
 *                                            a picker entry (the underscore
 *                                            on the FILE marks the partial;
 *                                            the folder is the family name)
 *   src/themes/<base>/<name>/<name>.css    — a theme inheriting that base
 *   src/themes/<name>/<name>.css           — a standalone theme
 *   …/<name>/variants/<v>.css              — a token-only variant of the
 *                                            theme whose folder it's in
 *
 * Creating or deleting one of those files is the only registration step: the
 * glob below loads every stylesheet and THEMES (the picker list + the body
 * classes each entry applies) is derived from the paths. A theme inside a
 * base's folder gets the base's marker class (`base-<x>`) alongside its own,
 * which is the only thing the base's scope selector targets — the base names
 * none of its inheritors. Each stylesheet wraps its rules in
 * `@layer themes { … }` itself, since glob-loaded modules can't be assigned
 * a layer by an importer.
 *
 * ORDER CONSTRAINTS (both load-bearing):
 * - _core.css is imported explicitly FIRST: inheriting themes override its
 *   token defaults by source order within the layer. The glob re-matches it,
 *   but modules execute once, so no duplicate CSS. Order among the themes
 *   doesn't matter (mutually exclusive scopes; variants win by specificity).
 * - main.css must land in the bundle before this module, so that its
 *   `@layer themes;` statement establishes the layer's position (after
 *   Tailwind's utilities, below main.css's unlayered rules) before any theme
 *   rule arrives. That holds because main.css is the first import of main.ts
 *   and this module is only reached through the app's component graph.
 */
import './core/_core.css'

const modules = import.meta.glob('./**/*.css', { eager: true })

export interface ThemeOption {
  /** Picker/storage id: 'moonlit' or, for a variant, 'moonlit/coolblue'. */
  id: string
  /** body classes this entry applies. */
  classes: readonly string[]
}

// Theme names start with a letter/digit; an optional <base>/ prefix marks
// inheritance — recognized only when the base's _<base>.css actually exists,
// so a theme accidentally nested inside another theme doesn't invent a base.
const THEME_RE = /^\.\/(?:([\w-]+)\/)?([a-z0-9][\w-]*)\/\2\.css$/
const VARIANT_RE = /^\.\/(?:([\w-]+)\/)?([a-z0-9][\w-]*)\/variants\/([\w-]+)\.css$/

const isBase = (name: string | undefined): name is string =>
  !!name && `./${name}/_${name}.css` in modules
const baseClasses = (base: string | undefined) => (isBase(base) ? [`base-${base}`] : [])

const themeMatches = (re: RegExp) =>
  Object.keys(modules)
    .map((path) => path.match(re))
    .filter((m): m is RegExpMatchArray => !!m && (m[1] === undefined || isBase(m[1])))

/** Every selectable theme, each followed by its variants. */
export const THEMES: readonly ThemeOption[] = themeMatches(THEME_RE)
  .sort((a, b) => a[2].localeCompare(b[2]))
  .flatMap(([, base, name]) => [
    { id: name, classes: [...baseClasses(base), `theme-${name}`] },
    ...themeMatches(VARIANT_RE)
      .filter((m) => m[2] === name)
      .sort((a, b) => a[3].localeCompare(b[3]))
      .map(([, vBase, , variant]) => ({
        id: `${name}/${variant}`,
        classes: [...baseClasses(vBase), `theme-${name}`, `variant-${variant}`]
      }))
  ])
