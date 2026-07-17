// Startup compatibility checks. The module reaches deep into PF2e private
// surface — Modifier prototype methods, Statistic.extend shadowing, inline
// enricher datasets, DamageRoll registration — and when a PF2e update shifts
// any of it, the failure mode is silent: an override that stops applying
// rolls the wrong number rather than throwing. So at ready-time we (a)
// compare the running system/core versions against the tested range and (b)
// probe the specific internals each feature hangs off, then surface one
// consolidated GM notice naming what may misbehave.

import { logger } from '@/utils/utilities'

// Tested ranges, maintained by hand at release time. PF2e: the code is
// written against the 7.x type packages and verified live against 8.3.0;
// Foundry: generations the module is used with (verified live on 14.364).
const PF2E_TESTED_MAJORS = { min: 7, max: 8 }
const FOUNDRY_TESTED_GENERATIONS = { min: 13, max: 14 }

// Narrow local shapes for the globals we probe — deliberately structural, so
// the probes themselves can't break when the upstream types move.
type CompatGame = {
  user?: { isGM?: boolean }
  system?: { version?: string }
  release?: { generation?: number }
  pf2e?: {
    Modifier?: { prototype?: { test?: unknown; applyAdjustments?: unknown } }
    actions?: { get?: unknown }
    TextEditor?: { _onClickInlineRoll?: unknown }
    Check?: { rerollFromMessage?: unknown }
    ElementalBlast?: unknown
  }
}
declare const game: CompatGame
declare const ui: { notifications?: { warn: (message: string) => void } }
declare const CONFIG: { Dice?: { rolls?: Array<{ name?: string }> } }

function majorOf(version: string | undefined): number | undefined {
  const major = Number.parseInt(version ?? '', 10)
  return Number.isFinite(major) ? major : undefined
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
  if (!CONFIG.Dice?.rolls?.some((r) => r?.name === 'DamageRoll')) {
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
  if (
    pf2eMajor !== undefined &&
    (pf2eMajor < PF2E_TESTED_MAJORS.min || pf2eMajor > PF2E_TESTED_MAJORS.max)
  ) {
    versionIssues.push(
      `PF2e ${pf2eVersion} is outside the tested range ` +
        `(${PF2E_TESTED_MAJORS.min}.x–${PF2E_TESTED_MAJORS.max}.x)`
    )
  }

  const generation = game.release?.generation
  if (
    typeof generation === 'number' &&
    (generation < FOUNDRY_TESTED_GENERATIONS.min || generation > FOUNDRY_TESTED_GENERATIONS.max)
  ) {
    versionIssues.push(
      `Foundry v${generation} is outside the tested range ` +
        `(v${FOUNDRY_TESTED_GENERATIONS.min}–v${FOUNDRY_TESTED_GENERATIONS.max})`
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
  if (game.user?.isGM) ui.notifications?.warn(message)
}
