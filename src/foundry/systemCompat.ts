// Startup compatibility checks. The module reaches deep into PF2e private
// surface — Modifier prototype methods, Statistic.extend shadowing, inline
// enricher datasets, DamageRoll registration — and when a PF2e update shifts
// any of it, the failure mode is silent: an override that stops applying
// rolls the wrong number rather than throwing. So at ready-time we (a)
// compare the running system/core versions against the tested range and (b)
// probe the specific internals each feature hangs off, then surface one
// consolidated GM notice naming what may misbehave.
//
// The tested ranges are NOT declared here. They are declared once in
// module.json — `compatibility` for Foundry, `relationships.systems` for PF2e —
// which is where Foundry itself reads them from, and this reads them back off
// the manifest it parsed at load. They used to be a second copy in this file,
// bumped by hand at release time alongside the manifest.

import { logger } from '@/utils/utilities'
import { MODULE_ID } from '@/api/protocol'
import { diceRollClasses, notifications } from './globals'

// Narrow local shapes for the globals we probe — deliberately structural, so
// the probes themselves can't break when the upstream types move.

// A package's declared compatibility range, as Foundry parsed it from a
// manifest. `verified` is "tested up to"; `maximum` is a hard bound Foundry
// itself refuses to start past.
type PackageCompatibility = { minimum?: string; verified?: string; maximum?: string }

type CompatGame = {
  user?: { isGM?: boolean }
  system?: { version?: string }
  release?: { generation?: number }
  // This module as Foundry parsed it at load: the manifest is where the tested
  // ranges are declared, so it is also where they are read from.
  modules?: {
    get?: (id: string) =>
      | {
          compatibility?: PackageCompatibility
          relationships?: {
            systems?: Iterable<{ id?: string; compatibility?: PackageCompatibility }>
          }
        }
      | undefined
  }
  pf2e?: {
    Modifier?: { prototype?: { test?: unknown; applyAdjustments?: unknown } }
    actions?: { get?: unknown }
    TextEditor?: { _onClickInlineRoll?: unknown }
    Check?: { rerollFromMessage?: unknown }
    ElementalBlast?: unknown
  }
}
declare const game: CompatGame

function majorOf(version: string | undefined): number | undefined {
  const major = Number.parseInt(version ?? '', 10)
  return Number.isFinite(major) ? major : undefined
}

// The tested major range a compatibility block describes, or undefined when the
// manifest doesn't say. `verified` is the upper bound because that is literally
// the field's meaning ("tested against"); `maximum` stands in for a manifest that
// declares only a hard bound — though Foundry would refuse to launch past it, so
// this code would never run to complain.
//
// Undefined means "no declared range", and the caller then skips the version
// check rather than inventing one. Silence is right there: the range used to be a
// pair of constants here that had to be bumped in lockstep with module.json, and
// a stale constant reports drift that doesn't exist (or misses drift that does).
function testedMajors(
  compatibility: PackageCompatibility | undefined
): { min: number; max: number } | undefined {
  const min = majorOf(compatibility?.minimum)
  const max = majorOf(compatibility?.verified ?? compatibility?.maximum)
  if (min === undefined || max === undefined) return undefined
  return { min, max }
}

function manifest() {
  return game.modules?.get?.(MODULE_ID)
}

// The module's own `compatibility` block: which Foundry generations it is for.
function foundryTestedGenerations(): { min: number; max: number } | undefined {
  return testedMajors(manifest()?.compatibility)
}

// The PF2e entry in `relationships.systems`: which system majors it is for.
function pf2eTestedMajors(): { min: number; max: number } | undefined {
  const systems = manifest()?.relationships?.systems
  if (!systems) return undefined
  // A Set in a live manifest, an array in a hand-built one — either iterates.
  for (const system of systems) {
    if (system?.id === 'pf2e') return testedMajors(system.compatibility)
  }
  return undefined
}

// Probe the PF2e internals each feature hangs off. Every entry names the
// user-visible capability first, so the consolidated notice reads as "what
// might be wrong at the table", not a stack of internal symbols.
function probeInternals(): string[] {
  const issues: string[] = []
  const pf2e = game.pf2e
  const modifierProto = pf2e?.Modifier?.prototype
  if (
    typeof modifierProto?.test !== 'function' ||
    typeof modifierProto?.applyAdjustments !== 'function'
  ) {
    issues.push('per-roll modifier overrides (Modifier prototype methods missing)')
  }
  if (!diceRollClasses().some((r) => r?.name === 'DamageRoll')) {
    issues.push('typed damage chat cards (DamageRoll not registered; plain rolls will be used)')
  }
  if (typeof pf2e?.actions?.get !== 'function') {
    issues.push('character actions (game.pf2e.actions missing)')
  }
  if (typeof pf2e?.TextEditor?._onClickInlineRoll !== 'function') {
    issues.push('inline check/damage links (TextEditor inline-roll pipeline missing)')
  }
  if (typeof pf2e?.Check?.rerollFromMessage !== 'function') {
    issues.push('chat rerolls (Check.rerollFromMessage missing)')
  }
  if (typeof pf2e?.ElementalBlast !== 'function') {
    issues.push('elemental blasts (ElementalBlast class missing)')
  }
  return issues
}

export function checkSystemCompat(): void {
  const versionIssues: string[] = []

  const pf2eVersion = game.system?.version
  const pf2eMajor = majorOf(pf2eVersion)
  const pf2eTested = pf2eTestedMajors()
  if (
    pf2eMajor !== undefined &&
    pf2eTested &&
    (pf2eMajor < pf2eTested.min || pf2eMajor > pf2eTested.max)
  ) {
    versionIssues.push(
      `PF2e ${pf2eVersion} is outside the tested range ` +
        `(${pf2eTested.min}.x–${pf2eTested.max}.x)`
    )
  }

  const generation = game.release?.generation
  const foundryTested = foundryTestedGenerations()
  if (
    typeof generation === 'number' &&
    foundryTested &&
    (generation < foundryTested.min || generation > foundryTested.max)
  ) {
    versionIssues.push(
      `Foundry v${generation} is outside the tested range ` +
        `(v${foundryTested.min}–v${foundryTested.max})`
    )
  }

  const brokenFeatures = probeInternals()
  if (!versionIssues.length && !brokenFeatures.length) return

  const parts: string[] = ['Tabula Mensa compatibility check:']
  if (versionIssues.length) parts.push(versionIssues.join('; ') + '.')
  if (brokenFeatures.length) {
    parts.push(
      'Features that may misbehave: ' +
        brokenFeatures.join('; ') +
        '. Affected rolls can produce wrong numbers rather than errors — ' +
        'update the module, or roll from the Foundry sheet if results look off.'
    )
  } else {
    parts.push('All internals the module relies on are still present, so this is advisory.')
  }
  const message = parts.join(' ')

  logger.warn('TABLEMATE: ' + message, { versionIssues, brokenFeatures })
  // GM-only, advisory (warn, not error): fires once per session at ready.
  if (game.user?.isGM) notifications()?.warn?.(message)
}
