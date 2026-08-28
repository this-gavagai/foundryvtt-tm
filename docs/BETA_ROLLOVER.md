# Beta Rollover Runbook

**Written:** 2026-08-27, during alpha (latest tag `alpha-0164`).
**Trigger:** execute when cutting the first beta build.

---

## How to use this document

Hand this to a Claude Code session with: *"Read docs/BETA_ROLLOVER.md and work through it with me."*

**Before executing anything, re-verify current state.** This was written against the
code as it stood on 2026-08-27 and cites specific files and line numbers. Months of
commits will have moved them. Every file reference below is a *pointer to intent*, not
a guarantee of location. The "State of the code" appendix records what was true at
writing time so you can diff against it.

Work top-down. Step 0 is blocking. Step 1 is the only part with a hard deadline —
everything else can land after beta-0 ships.

---

## Background (self-contained — assume the reader knows nothing)

Tabula Mensa is a PF2e character sheet for FoundryVTT, in two halves built from one
repo and released by one git tag (`.github/workflows/build-and-release.yml`):

- **The Foundry module** (`src/foundry/*` → `tablemate/`, shipped as a GitHub release
  zip). Runs inside the GM's Foundry client. Reaches deep into PF2e internals.
- **The app** (`src/*` Vue) — shipped two ways: served by the Foundry server as a PWA
  out of the same zip, and built separately via Capacitor into iOS/Android binaries
  (`npm run cap:sync`, `--mode capacitor` → `dist/`).

They talk over a Foundry socket channel. The contract is `src/api/protocol.ts` +
`src/types/api-types.ts`.

**Where skew comes from.** The PWA can never skew — it ships in the same zip as the
module, so a GM who updates the module updates both halves atomically. Only **native
binaries** can skew, and in both directions:

- *App newer than module* — the GM hasn't updated. Expect this to be the **dominant**
  case: iOS auto-updates apps by default, while a GM mid-campaign is the single most
  conservative updater in the system. One stale GM strands every tablet at the table.
- *Module newer than app* — App Store review latency, TestFlight builds users ignore,
  auto-update disabled.

**What already exists (this is a good foundation — do not rebuild it).**
- `PROTOCOL_VERSION` in `src/api/protocol.ts`: an integer, currently 4, bumped only on
  breaking wire changes, with a documented history comment.
- `CAPABILITY_*` string flags for additive features, advertised by the module and
  gated app-side. Four exist: `voiceMemo`, `imageUpload`, `voiceMemoTranscript`,
  `reactions`.
- A bidirectional handshake: module → app on `LISTENER_ONLINE` (`announceSelf()` in
  `src/foundry/listener.ts`), app → module piggybacked on the `ANYBODY_HOME` presence
  heartbeat (`pingHeartbeat()` in `src/stores/listenersOnline.ts`).
- App-side state in `src/stores/versionCompat.ts` and an advisory
  `src/components/VersionMismatchBanner.vue`.
- Precedent for backward compatibility: `src/foundry/handlers/checks/subtype.ts`
  decodes pre-protocol-3 wire forms, with legacy fixtures copied verbatim from the old
  client encoders in `src/foundry/handlers/__tests__/checkSubtype.spec.ts`.

---

## The invariants being adopted at beta

These are the rules the rest of this document implements. Write them down (Step 5) and
hold to them.

1. **A native app update is never required to keep working** — only to gain features.
2. **The app degrades gracefully against any module back to the beta-0 floor.** It
   connects, authenticates, syncs a character, and hides what the module can't serve.
   *Not* feature parity — parity with an older module is impossible by construction.
3. **The module stays backward-compatible with older apps** for the stated window. The
   module is the half you can ship a same-day fix to, so it absorbs incident response.
4. **Additive changes are capabilities, not protocol bumps.** Reserve the integer for
   changes that are genuinely un-decodable by the other side.
5. **Skew degrades; it never blocks.** Both sides' mismatch signals stay advisory.

---

## Step 0 — Decisions required before any code changes (BLOCKING)

Ask the user each of these. Do not assume defaults.

**0.1 — The support window.** How far back must the app support modules? There is
**no telemetry in this project**, so you can never *learn* that a floor is safe to
raise. The window must therefore be time-based, not usage-based.
*Recommendation:* "modules released within the last 12 months." Without a stated
window, every compatibility branch added below lives forever.

**0.2 — Delete or keep the legacy decoders.** `src/foundry/handlers/checks/subtype.ts`
exists to serve pre-protocol-3 apps. No such app deserves support in beta. Deleting it
is *correct now* and *wrong the day beta-0 ships*.
*Recommendation:* delete the pre-beta legacy paths, but keep the fixture-test pattern
from `checkSubtype.spec.ts` — that harness is the valuable part and Step 4 generalizes it.

**0.3 — The protocol floor number.** Pick the `PROTOCOL_VERSION` that means "first
beta." Everything below it is unsupported, permanently.
*Recommendation:* bump once to the next integer as the beta floor and note it in the
history comment as the floor, rather than renumbering from 1.

**0.4 — The tag scheme.** Tags are currently `alpha-NNNN`. The tag is baked into
`__APP_VERSION__` (via `APP_VERSION` in the workflow), into `module.json`'s `version`
field, and displayed in the mismatch banner. Pick the beta scheme before the first beta
tag, not after. Whatever you choose should sort sensibly and be comparable — the banner
shows app and module versions side by side.

**0.5 — Confirm the deferred architectural option stays deferred.** During design an
alternative was considered and set aside: **the native shell loads the app bundle from
the connected Foundry server** (Capacitor `server.url` / remote bundle) instead of its
own `dist/`. This eliminates skew by construction, because the UI and module then ship
from the same zip. It was deferred because of its costs: a user-supplied Foundry URL
would own the Capacitor bridge (secure storage holding credentials, push tokens,
filesystem); offline and pre-connect UI need a local fallback anyway; the installed
Capacitor plugin set becomes a *third* version axis; and there is moderate App Store
review risk. Revisit only if native skew becomes the dominant support burden. Do not
re-propose it as part of this rollover.

**Note the inverse of 0.5:** stripping the *Foundry module* down and having it fetch
remote versioned JS was also considered and rejected. It adds flexibility to the half
that is already flexible, breaks LAN/offline tables, sits badly with Foundry package
guidelines, and relocates the frozen interface into a loader shim you can never patch.
Do not propose it.

---

## Step 1 — Wire fields that MUST ship in beta-0 (HARD DEADLINE)

**Why this is the only deadline-bound step:** beta-0 is the oldest build you will ever
have to support. Whatever it does not *say* about itself, you can never learn from it —
you would be stuck special-casing it forever, exactly like the existing
`protocol === undefined` branch for pre-handshake builds. These fields are additive and
cost nothing to ship unused.

### 1.1 — Module → app additions

In `announceSelf()` (`src/foundry/listener.ts`, ~line 466 as of writing), alongside the
existing `protocol` / `moduleVersion` / `capabilities` / `manualRollPolicy` / `tokenRing`:

- `minProtocol: number` — the oldest protocol this module can serve.
- `systemVersion: string` — `game.system.version`. **This is the highest-value field
  here**; see the risk note below.
- `systemIssues: string[]` — the result of `probeInternals()` from
  `src/foundry/systemCompat.ts`.

**Why `systemVersion` and `systemIssues` matter more than they look.**
`src/foundry/systemCompat.ts` is thorough — it reads tested ranges off `module.json` and
probes the specific PF2e internals each feature hangs off — but it is **module-side only
and warns the GM**. The app has *zero* PF2e version awareness: it parses PF2e wire JSON
directly (`src/types/character-types.ts`; the actor objects are plain JSON with no
runtime PF2e behavior). An old module is almost certainly running an old PF2e, so
"the app supports all prior modules" silently means "the app parses all prior PF2e data
shapes" — an axis outside your control, not covered by capabilities, and currently
invisible to the app. Putting these two fields on the wire is what makes that axis
*addressable* later.

### 1.2 — App → module additions

In `pingHeartbeat()` (`src/stores/listenersOnline.ts`), alongside the existing
`protocol` / `appVersion`:

- `minProtocol: number`
- `capabilities: string[]` — ship it **empty** in beta-0. This is cheap insurance: the
  native shell has its own version axis (Capacitor plugin APIs, BLE, push, secure
  storage) that nothing currently models. An empty array is a version you can reason
  about; an absent field is not.

### 1.3 — Type updates

Add the fields to `ListenderOnlineArgs` and `AnybodyHomeArgs` in
`src/types/api-types.ts`. Mark them optional (`?`) with a comment explaining that
absence means "predates the beta floor," matching the convention already used there.

### 1.4 — Module-side client registry

`checkClientVersion()` (`src/foundry/listener.ts`, ~line 59) currently reads
`args.protocol`, compares it, and **throws it away** — it retains only a throttle
timestamp in `versionWarnings`. So no handler can ask "which app am I answering?"

Replace that with a retained `Map<userId, { protocol, minProtocol, appVersion,
capabilities, lastSeen }>`, populated on `ANYBODY_HOME`, reachable from the handlers in
`src/foundry/rpcTable.ts` via the dispatch context.

This is the precondition for invariant 3 — without it, "the module is the compatible
half" is aspirational, because the module can *detect* skew but cannot *adapt* to it.
It is module-side, so strictly it can land any time; do it now while the wire work is
already open.

### 1.5 — App-side plumbing

Extend `src/stores/versionCompat.ts` to hold `moduleMinProtocol`, `systemVersion`, and
`systemIssues`, fed from the `LISTENER_ONLINE` handler in `src/api/socketSetup.ts`.
Expose them; nothing needs to consume them yet.

---

## Step 2 — Alpha-only cleanup (free now, expensive after beta-0)

Alpha is the last time a breaking change costs nothing. Spend it deliberately.

**2.1 — Batch every known breaking change into one final bump.** Whatever protocol
warts are known, fix them all in one bump landing in beta-0. After beta-0, each bump
strands a real user population.

**2.2 — Execute decision 0.2** (delete or commit to the legacy decoders).

**2.3 — Run the "should this have been a capability?" audit.** Read the
`PROTOCOL_VERSION` history comment in `src/api/protocol.ts` against invariant 4. As of
writing it is instructive:
- *Bump 2* (optional `error` on the ack) — purely additive. An app ignoring `error`
  degrades to a timeout: bad, not broken. **Should have been a capability.**
- *Bump 3* (typed `checkSubtype` object) — genuinely un-decodable. Correct bump.
- *Bump 4* — half additive (`targetScene` is optional with a working fallback: an older
  app resolves against the active scene). The `SHARE_TARGETS` reshape is the genuinely
  breaking half. **Should have been split.**

Roughly two of four bumps stranded users who did not need stranding. Doing this audit
is how the rule becomes instinct before it costs a support cycle.

**2.4 — Free rename.** `ListenderOnlineArgs` in `src/types/api-types.ts` is a typo
(`Listender`). Renaming is free now and never worth a diff later.

---

## Step 3 — Replace equality with range negotiation

Both sides currently use strict equality, which is the harshest possible rule and
misfires on the *benign* direction. The protocol-3 history comment says an older app
"keeps working against a newer module" — and then both sides flag it anyway.

- `src/stores/versionCompat.ts` — `isMismatched` is
  `heardFromModule && moduleProtocol !== PROTOCOL_VERSION`.
- `src/foundry/listener.ts` — `checkClientVersion` returns early only on
  `protocol === PROTOCOL_VERSION`, otherwise raises a GM notification.

Replace both with **range overlap**: each side advertises `[minProtocol, protocol]`;
compatible means the ranges intersect. Keep both signals advisory (invariant 5) — the
banner in `VersionMismatchBanner.vue` is already non-blocking and dismissible, which is
the right shape; the module's GM notification should likewise stay a transient notice.

Also add a *capability-shaped* degradation path so a partial mismatch hides individual
features rather than showing a whole-app warning.

---

## Step 4 — The compatibility fixture harness

Generalize the pattern already proven in
`src/foundry/handlers/__tests__/checkSubtype.spec.ts`: golden wire fixtures per
supported protocol version, replayed against the current handlers in
`src/foundry/rpcTable.ts`.

**Build it at beta-0, when there is exactly one version to record.** You capture the
baseline as you go. Doing it later means reconstructing old wire shapes out of git
history to seed it.

This is what makes the support window *trustworthy* rather than hopeful — it converts
"we think the old decoder still works" into a build failure when it doesn't.

**Also test the app against capability sets, not module versions.** This is the insight
that keeps the matrix tractable: if every feature gates on a flag, app behavior is a
function of the capability *set*, not the version number. Test the floor (empty set),
today (full set), and the real intermediate sets that actually shipped — a handful of
cases, not N.

---

## Step 5 — Write the policy down

Create `docs/PROTOCOL.md` (or a section in a root `CLAUDE.md`, which does not exist as
of writing) stating:

- The five invariants above.
- The support window from decision 0.1, and the floor from 0.3.
- **What earns a protocol bump vs. a capability flag**, with the Step 2.3 audit as
  worked examples.
- The rule that new features ship with a capability flag *by default*.

The audit in 2.3 exists because this was not written down. Write it down.

---

## Step 6 — Release mechanics

- Apply the tag scheme from decision 0.4.
- `.github/workflows/build-and-release.yml` sets `prerelease: true` — decide whether
  beta keeps that (probably yes).
- Confirm `APP_VERSION` still bakes the tag into the bundle *before* the post-build
  `package.json` / `module.json` edits. The workflow comment already flags this
  ordering as load-bearing; don't let a refactor reorder it.
- Sanity-check that `module.json`'s `compatibility` and `relationships.systems` ranges
  are current, since `systemCompat.ts` reads its tested ranges back off that manifest
  rather than from constants.

---

## Verification checklist

Before tagging beta-0:

- [ ] Every Step 1 field is on the wire and present in a real build's handshake.
- [ ] `npm run type-check`, `npm test`, `npm run lint` clean.
- [ ] The module still answers an app that sends *none* of the new fields (simulate the
      pre-beta case) without throwing.
- [ ] The app still renders against a module that sends *none* of the new fields.
- [ ] Range negotiation accepts an overlapping pair and flags only a disjoint one.
- [ ] Mismatch degrades — the app remains usable, no blocking modal, banner dismissible.
- [ ] Fixture harness records the beta-0 baseline and passes.
- [ ] `docs/PROTOCOL.md` exists and states the window, the floor, and the bump rule.
- [ ] A native build (`npm run cap:sync`) works against a module built from the same tag.
- [ ] **Foundry-side changes need a Foundry client reload (F5) to test** — the dev
      server only HMRs the app half.

---

## Known risks and open questions

1. **The PF2e axis is the real threat.** Not capabilities, not the protocol. Supporting
   old modules means parsing old PF2e data shapes, PF2e reshapes things across majors,
   and it is entirely outside your control. Step 1.1 makes it *visible*; it does not
   solve it. Expect to need app-side shape decoders eventually, and expect this — not
   the protocol — to be what eventually forces the floor up.

2. **No telemetry means no safe-to-raise signal.** You will never observe that a floor
   is unused. Time-based window only (decision 0.1).

3. **Capability gates accumulate.** Each `if (supportsX)` is a permanent branch until
   the floor rises. With a stated window you can delete them on a schedule; without one
   the app slowly becomes a museum.

4. **Response-shape drift is the part capabilities don't cover.** Flags answer "the
   module can't do X." They don't answer "the module does X but answers in an older
   shape." That case needs app-side decoders — the mirror image of `subtype.ts`. Real,
   bounded work, and it is where "support all prior versions" actually costs you.

---

## Appendix — State of the code as of 2026-08-27

Diff against this to see what has drifted.

| Fact | Value |
|---|---|
| Latest tag | `alpha-0164` |
| `PROTOCOL_VERSION` | 4 (history for 2, 3, 4 documented in `src/api/protocol.ts`) |
| Capabilities | `voiceMemo`, `imageUpload`, `voiceMemoTranscript`, `reactions` |
| App-side gates in use | `ChatOverlay.vue` (3), `useChatActions.ts` (1) |
| Module handshake | `announceSelf()`, `src/foundry/listener.ts` ~L466 |
| App handshake | `pingHeartbeat()`, `src/stores/listenersOnline.ts` |
| Module-side check | `checkClientVersion()`, `src/foundry/listener.ts` ~L59 — discards client protocol |
| App-side check | `isMismatched`, `src/stores/versionCompat.ts` ~L29 — strict equality |
| PF2e awareness | Module only (`src/foundry/systemCompat.ts`); app has none |
| `module.json` ranges | Foundry min 13 / verified 14; PF2e min 7.0.0 / verified 8.3.0 |
| Legacy decoders | `src/foundry/handlers/checks/subtype.ts` (pre-protocol-3) |
| Foundry-side LOC | ~5,600 across `src/foundry/` |
| Docs | None (`docs/` created by this file); no root `CLAUDE.md` |
