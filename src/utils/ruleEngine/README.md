# The rule engine

A small PF2e rule-element evaluator that runs **in the app, on source data**.

It exists for one situation: a character sheet no GM has answered for. The world
dump the Foundry server serves is unprepared source data — `system.saves` is
`{}`, `system.perception` is `null`, `system.movement` is absent entirely, and on
the ten-character test table six characters had no `system.attributes` IWR at all
— so the alternative to deriving these figures is showing blanks.

**The GM's answer always wins.** Whenever a character payload carries a prepared
figure, that figure is displayed and the engine is not consulted. This is
enforced at one place, `statOrDerived` in
`composables/character/characterStats.ts`, which tests for what only preparation
produces (`totalModifier`, `breakdown`, or a modifier list) rather than for a
value being merely present — a world dump has stale zeroes that pass the weaker
test.

**Nothing the engine computes is ever written back to a document.** Persisting an
estimate makes it the record and destroys the oracle that keeps the engine
honest: PF2e's own answer, arriving on the next payload.

## The two consumers

1. **The cold sheet.** No GM has answered. The engine is the only source for AC,
   saves, skills, perception, initiative, hit points, speeds, spell DCs, the
   focus pool and IWR. Figures are marked `provisional` where it had gaps.
2. **Post-write change detection.** A GM *has* answered, so the payload is
   canonical — until a local write moves something. `utils/derivedFigures.ts`
   recomputes every derivable figure and `utils/derivedReconcile.ts` drops the
   payload's copy wherever the engine's answer *moved*. The move is the
   invalidation signal; there is no dependency map. Each such recompute is also
   a **prediction**, checked against the next payload.

## What is implemented

Two rule element types, out of roughly forty:

- **FlatModifier** — the large majority of what moves a check or defence total.
- **ActiveEffectLike**, numeric modes only, against a caller-supplied set of
  paths. Not optional: PF2e raises proficiency ranks this way, and a rank read
  wrong puts a save four to six points out while looking ordinary.

Plus three special-cased families that are not FlatModifier and could not be
skipped without leaving a whole panel blank: `BaseSpeed` and the code-constructed
armour/shield speed penalties (`movement.ts`), and
`Immunity`/`Weakness`/`Resistance` (`iwr.ts`). `ActorTraits` is read for the
actor's trait list.

Every other `key` is **counted, not ignored** — see the ledger below. Four keys
are exempt because they cannot move a total: `Note`, `AdjustDegreeOfSuccess`,
`RollTwice`, `SubstituteRoll`.

## The three-valued core

The engine cannot see PF2e's roll-option set, so **absent must not mean false**.
A predicate reading `{not: "self:armored"}` is *true* when the option is
genuinely missing and *unknowable* when the engine merely cannot see it, and
those produce different numbers.

`rollOptions.ts` therefore classifies every atom (`AtomKind`):

| kind | meaning | a predicate on it |
| --- | --- | --- |
| `base` | persistent actor state the engine enumerates, or that PF2e told us about | answered true/false |
| `context` | only a roll can introduce it (`action:`, `target:`, `origin:`, `item:`) | answered as absent — PF2e does the same for a displayed statistic |
| `opaque` | might be base state; the engine cannot tell | **unknown** |

`predicate.ts` is Kleene logic over those three values. An `or` with one true arm
is true even with an unknown arm; an `or` with no true arm and one unknown arm is
unknown.

`asPersistent()` re-asks with context atoms withheld. It decides **nothing** about
any number — its only job is to tell "false because the roll hasn't happened"
from "false because this character can never trigger it", which is the difference
between a modifier worth showing as "+2 vs traps" and one worth hiding.

`item:` is classified as context **only because this engine derives no strikes.**
Adding strike derivation means revisiting that line: the classification would
have to become domain-aware.

## Three outcomes per rule, and where each goes

| outcome | ledger field | shown as |
| --- | --- | --- |
| resolved and applies | `modifiers` | a row in the breakdown |
| resolved, waiting on a roll | `ledger.conditional` | a **disabled** row in the breakdown |
| not resolved | `ledger.skipped` | the figure is marked `provisional` |

The middle row is not a gap. `sealLedger` deliberately keeps conditionals out of
the confidence verdict: a figure with six modifiers waiting on a roll is the same
number PF2e reports, arrived at the same way.

## The confidence contract

- `exact` — nothing was skipped. The number should equal PF2e's.
- `provisional` — something was skipped. A lower bound on *confidence*, not on
  value: a skipped penalty makes the figure too high, a skipped bonus too low.
- `unverified` — the world runs a PF2e version this engine was not checked
  against (`VERIFIED_PF2E_VERSION`, major/minor only). Nothing may *look* wrong;
  that is the point.

A **missing** stamp is not a mismatched one. No stamp is the ordinary state on a
cold sheet, it is identical for every figure, and letting it speak drowned the
per-figure signal it shares a channel with.

`describeLedger` is **player-facing** — it lands inside "Calculated on this
device — {caveat}. The GM has not confirmed it." — so it names the items on the
character sheet. The `SkipReason` taxonomy is for the console, via `skippedBy` on
a differential row and `bySkippedKey` in the harness summary.

## Where the GM is fed rather than re-implemented

Three relationships to a PF2e predicate exist in this codebase, and two of them
are better than evaluating it here:

- **Feed it.** The roll path's conditional action modifiers: the GM extracts the
  enabling atoms (`enableOptions` in `foundry/handlers/characterDetails.ts`), the
  player clicks the disabled row, and the roll carries those roll options so
  *PF2e's* evaluator decides. Cannot be wrong.
- **Amputate it.** `foundry/handlers/checks/modifierOverrides.ts` empties a live
  `Modifier`'s predicate for the duration of one roll so `test()` short-circuits.
  Blunt, local, restored in `finally`.
- **Re-implement it.** This engine — the only option when no GM is there at all.

`rollOptionSet` on the character payload is `actor.getRollOptions()`, sent whole.
Where it is present it is the authority: presence is a fact, and the toggle-state
guessing (`rule.value` falling back to `!rule.toggleable`) stands down. It does
**not** make every atom answerable — it describes the actor at the moment the
payload was built, and a local write since then could have moved anything.

## Performance

`resolve()` in `statistics.ts` computes the proficiency ranks, the roll-option set
and the value context **once per actor**, cached in a `WeakMap` keyed on the
`DerivationInput` **object**. The sheet builds one such object per actor change
and hands the same one to every figure.

This matters more than it looks. The rank pass runs the ActiveEffectLike pass over
every item and rule on the actor; when each figure ran its own, a full sheet fired
it **27 times** — 4.4 ms for a 102-item character on a desktop, repeated by the
reconciler on every write and by the dev harness on every payload. Handing out a
fresh input object per figure silently restores that cost.

## Measurement, and why it is load-bearing

Every character payload carries PF2e's own answers for the same actor the engine
can be run against, which makes each payload a labelled example.
`differential.ts` runs the engine against every payload in development and
reports, per figure:

- `valueMismatch` — same modifier, different number. Arithmetic.
- `engineOnly` — the engine produced a modifier PF2e did not. Over-application;
  inflates a defence.
- `silentMiss` — PF2e has a modifier from a FlatModifier on this actor that the
  engine neither produced **nor** recorded as skipped. This indicts the honesty
  machinery itself and outranks the other two.
- whole **totals**, which is strictly stronger: it exercises the base arithmetic
  (ranks, dex caps, ancestry HP) the modifier comparison cannot see.

**The harness must be configured exactly as the sheet is**, or it is measuring a
different engine. `usedSource` and `usedTraitVocabulary` on each report, and
`misconfigured` in the summary, exist because that failed silently once:
production passed a trait vocabulary and the harness never did, so bare trait
atoms were `opaque` in the measurement and `context` on the sheet — a modifier
gated on `{not: "trap"}` was *skipped* in the report and *applied* on screen, the
flattering direction and the hardest to notice.

Inspect from the console: `window.__tmRuleEngine.summary()`,
`.predictions()` (figures a write predicted wrongly), `.figures()` (what each
figure and the payload say right now).

## Writing comments in here

Describe **present behaviour**, and cite pf2e source where a decision is copied
from it. Do not argue with a previous version of the file: a reader cannot tell
which sentences are current, and this directory spent its first week that way —
`unconfirmable-rank` was documented in three places as a live concern after
nothing emitted it any more.

The history is in git. `foundry/handlers/checks/modifierOverrides.ts` is the
in-repo model: more invasive than anything here, and readable in one pass,
because every comment names a PF2e mechanism and what breaks without the hack.

## Known limits

- Untrained proficiency assumes PF2e's default; the "untrained equals level"
  world setting is invisible from here, so such a world reads every untrained
  figure low.
- `deriveClassDC` and rank options for class DC / base spellcasting exist but are
  **not wired to the sheet** — class DC is displayed from
  `system.proficiencies.classDCs`, which a world dump does not carry.
- IWR `doubleVs`, `applyOnce` and the `definition` predicate behind a `custom`
  type are not modelled; a custom entry shows with its label.
- `CreatureSize` rule elements do not move the derived actor size.
- Strikes are not derived at all. See the `item:` note above before changing that.
