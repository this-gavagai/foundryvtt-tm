# tablemate-push-relay

A stateless [Cloudflare Worker](https://workers.cloudflare.com/) that sends push
notifications for Tabula Mensa. **Milestone 1** covers Apple (APNs) only, with a
single test endpoint. FCM/Web Push, token storage, and the Foundry-module
trigger come in later milestones.

Runs on Cloudflare's free tier (100k requests/day) → effectively $0. APNs itself
is free (it rides your existing $99/yr Apple Developer account).

## What it does

`POST /send` signs a short-lived ES256 JWT with your APNs auth key and delivers
one alert to a device token you pass in. That's it — enough to prove the hardest
link (getting Apple to ring your phone) before wiring up anything else.

---

## Step 1 — Create an APNs auth key (once)

1. Go to [Apple Developer → Keys](https://developer.apple.com/account/resources/authkeys/list) → **+**.
2. Name it (e.g. "Tabula Mensa Push"), tick **Apple Push Notifications service (APNs)**, Continue → Register.
3. **Download the `.p8`** — you only get one chance. Keep it safe.
4. Note the **Key ID** (shown on the key's page, 10 chars).
5. Note your **Team ID** (top-right of the portal, or Membership page, 10 chars).
6. Your bundle ID is already `io.github.thisgavagai.tablemate` (see `wrangler.toml`).

## Step 2 — Store the key outside the repo

The `.p8` never goes in this folder. Keep it wherever you keep your other Apple
keys (e.g. `~/.config/apns/tablemate/`), then point an external config file at it
— the same pattern as `fastlane/.env` → `APP_STORE_CONNECT_KEY_FILE`.

```sh
mkdir -p ~/.config/tablemate-push-relay
cp relay/relay.env.example ~/.config/tablemate-push-relay/relay.env
# edit relay.env: APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_FILE (path to the .p8), RELAY_TEST_SECRET
```

> A Cloudflare Worker can't read a local file at runtime (no filesystem on the
> edge). So the deploy step reads your external `.p8` once and uploads it into
> Cloudflare's encrypted secret store — the file itself stays outside the repo.

## Step 3 — Deploy the relay

```sh
cd relay
npm install
npx wrangler login

npm run secrets   # reads ~/.config/tablemate-push-relay/relay.env + the external .p8, uploads all secrets
npm run deploy
```

`wrangler deploy` prints the URL, e.g. `https://tablemate-push-relay.<your-subdomain>.workers.dev`.

`APNS_ENV` lives in `wrangler.toml` (not a secret). Leave it `sandbox` while
testing from Xcode; switch to `production` for TestFlight/App Store builds.

To point at a different config file (e.g. on CI): `RELAY_ENV=/path/to/relay.env npm run secrets`.

## Step 4 — Get a device token

The app now registers for push on native launch and logs its token (see
`src/api/pushNotifications.ts`). To get a token:

1. In Xcode (`npm run cap:open:ios`): select the **App** target → **Signing &
   Capabilities** → **+ Capability** → **Push Notifications**. With automatic
   signing this also enables Push on the App ID.
2. Run the app on a **physical iPhone** (the Simulator can't mint a real APNs
   token). Accept the notification permission prompt.
3. In the Xcode console, find the line `[push] device token:` and copy the token.

APNS_ENV must match: an Xcode/development build ⇒ `sandbox` (the default).

## Step 5 — Send a test push

```sh
curl -X POST https://tablemate-push-relay.<your-subdomain>.workers.dev/send \
  -H "authorization: Bearer <RELAY_TEST_SECRET>" \
  -H "content-type: application/json" \
  -d '{"deviceToken":"<DEVICE_TOKEN>","title":"Tabula Mensa","body":"It works!"}'
```

Success → `{"ok":true, ...}` and the banner appears on your phone.

---

## Troubleshooting

The `apns.body` field in the JSON response carries Apple's reason on failure:

| Response | Meaning / fix |
| --- | --- |
| `BadDeviceToken` | Token/environment mismatch. Xcode build → `APNS_ENV=sandbox`; TestFlight/App Store → `production`. Also check the token was copied whole. |
| `TopicDisallowed` / `Forbidden` | `APNS_BUNDLE_ID` doesn't match the app, or the key isn't enabled for APNs. |
| `ExpiredProviderToken` / `InvalidProviderToken` | Wrong `APNS_KEY_ID` / `APNS_TEAM_ID`, or the `.p8` was pasted incompletely. |
| `MissingTopic` | `APNS_BUNDLE_ID` var is empty. |
| 401 from the relay (not APNs) | `RELAY_TEST_SECRET` in the curl header doesn't match the deployed secret. |

Watch live logs while testing: `npx wrangler tail`.

## Privacy

Push is **off by default** — a GM enables it per world (Tablemate settings →
"Enable push notifications"), an informed opt-in because it sends data off the
table. When enabled, for each chat message the relay receives: the world's opaque
id, the recipient user ids, the sender's display name, and — **only if the GM also
enables "Include message text"** — the message body. Device tokens are sent once
at registration. This data transits the relay (Cloudflare) and Apple/Google in
order to deliver the notification.

- With "Include message text" **off** (default), message content is never sent to
  the relay at all — notifications are sender-only.
- The relay **stores** only device tokens (in KV, keyed by world+user) and short
  rate-limit counters. It does **not** store notification content. Tokens are
  pruned when APNs reports them dead, after 30 days without re-registration, or
  immediately when the app calls `/unregister` (which it does when you remove a
  server, or register as a different Foundry user on one).
- To stop all of it, turn off "Enable push notifications" in the world settings.

## Abuse controls

The Worker applies coarse per-minute limits through the [Workers rate-limiting
binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
(`[[ratelimits]]` in `wrangler.toml`, Wrangler ≥ 4.36): `/notify` per world —
**two independent buckets**, ambient (60) and direct (60) — and per-IP caps on
`/provision` (20), `/register` (30) and `/unregister` (30). `/notify` also
per-IP-throttles *failed* authorisation (30), which costs a legitimate caller
nothing: charging every notify a per-IP counter would spend two subrequests per
message to throttle a caller the world key already excludes.

These were KV counters until recently, and that was backwards. A KV counter
writes on every request it **allows**, so a single source could spend the free
plan's ~1,000 KV writes/day through the rate limiter alone, in about a minute —
the very budget the limiter exists to protect. Once it is gone the writes that
must *not* be swallowed start failing too: `/provision` and `/register` 500, and
no device in any tenant can register. The binding costs no KV write and no
subrequest, which also hands `/notify` back four subrequests per message.

The binding counts per Cloudflare location rather than globally. That is less of
a downgrade than it sounds — the KV counter was eventually consistent anyway, and
both an abusive source and the single GM client sending a world's notifications
land in one location — but it does mean a **distributed** attacker can still
exceed these ceilings. Closing that gap is the edge rule below, not KV.

If a deployment has no bindings configured (an older Wrangler), the Worker falls
back to the KV counters: you lose the improvement, not the limit.

The split matters: a message is "direct" when it was whispered to you or names
your username (the module marks those recipients in `/notify`'s `direct` field).
Sharing one bucket meant a combat round's worth of ambient chat on
`pushScope: 'all'` could exhaust the world's budget and silently drop the whisper
that arrived at second 55. When only one class is over limit the other still
delivers, and shed recipients are reported in the response rather than passing as
a successful send.

`/register` also rejects a malformed device token (APNs tokens must be hex; the
length is bounded generously, since Apple documents it as variable). The token is
interpolated into the APNs request path, and something that is not a token can
never be delivered to — worse, the fetch throws before Apple answers, so it is
never reported dead and nothing prunes it. Entries stored before this check are
skipped at delivery time and left to the 30-day sweep.

**Deploying this relay includes adding a Cloudflare Rate Limiting rule** (free
tier), in the dashboard: Security → WAF → Rate limiting rules → match
`http.request.uri.path in {"/provision" "/register" "/unregister" "/notify"}`,
100 requests / 1 min per client IP, action Block.

Treat this as part of the deploy, not an optional hardening step. It is the only
control here that is enforced *globally* and *before the Worker runs* — every
in-Worker limit is per-location and only after Cloudflare has already billed you
an invocation. Without it, a distributed source can spread itself across
locations, stay under every binding's ceiling, and still burn the account's
100,000 daily Worker requests. With it, the in-Worker limits are what they are
meant to be: a cheap second line, not the only one.

## Diagnosing it from Foundry

Every failure in this feature is silent by construction — a failed provision, a
relay that moved, a world where nobody ever opened the app all look the same from
the GM's chair: no notifications, no error. So the module ships a panel:
**Settings → Tabula Mensa → "Check push notification status"** (GM only). It
reports whether the world is provisioned, whether the relay answers, which users
have a device registered, and can send the GM a test notification that bypasses
every recipient rule — if that arrives, the plumbing works and anything still
missing is a scope/mention rule rather than transport. It also re-runs
provisioning, so opening it repairs a world whose first attempt failed offline.

Backing that panel is `POST /status` (bearer the world key): read-only, returns
`{provisioned, devices: {userId: count}, unsupported, truncated}` counting only
registrations recent enough to still be pushed *and* on a platform the relay can
actually reach — an Android registration is stored but never delivered to, so it
is reported as `unsupported` rather than counted as a device that will hear
something. `truncated` says the user list was longer than one call may read (see
the subrequest ceiling below); the module chunks and merges. A wrong key and an
unknown world both answer 401 — the only actionable fact is "this relay will not
take your world's pushes", and distinguishing them would leak which worlds exist.

Self-hosting: the relay URL is a world setting (**Push relay URL**), defaulting to
the shared instance. Point it at your own deployment and the world re-provisions
there; devices follow on their next app foreground.

## Free-plan limits and how the relay degrades

Two Cloudflare free-plan ceilings shape the delivery path, and both used to fail
in ways that cost notifications:

- **KV writes (~1,000/day, account-wide, deletes included).** This is the binding
  constraint on the whole relay, and it is a *daily* quota — no per-invocation
  budget can see it coming. Two things used to spend it faster than anything else,
  and both have been dealt with: the per-IP rate-limit counters (now the
  rate-limiting binding, above) and the badge, which cost a read and a write per
  device per push until it was made **direct-only**. Ambient chat — the volume —
  now moves no badge at all, and the count means something better for it: how many
  people whispered or named you, not how much the table has been talking.

  The remaining writer is `/register`, which the app calls on every foreground.
  Almost every one of those repeats the last, so a re-registration that changes
  nothing and is younger than `REGISTRATION_REFRESH_MS` is answered **without a
  write**, and the badge reset reads before it deletes. The routine heartbeat
  therefore costs reads (100,000/day) rather than writes.

  Everything discretionary still goes through the `kv*` helpers, which swallow
  failures: a push goes out even if its bookkeeping cannot be persisted.
  Registration *reads* stay strict — not knowing where to send is a real error,
  and one the module retries.
- **Subrequests — and there are two ceilings, not one.** A free-plan invocation
  may make **50 external** subrequests (`fetch()`, i.e. the APNs sends) and,
  separately, **1,000 operations to Cloudflare services** (the KV reads and
  writes). These were once budgeted as a single pool of 44 on the belief that KV
  drew on the same 50, which charged about four units per device where only one
  was external — so a dozen devices spent the allowance on bookkeeping and
  everyone past them was shed.

  `MAX_APNS_SENDS` (46) now budgets the sends, and `MAX_KV_OPS` (400) bounds the
  KV side generously — 400 against a limit of 1,000 will not bind for any table,
  and it exists so that being wrong about a ceiling degrades into a reported shed
  rather than a mid-loop throw that 500s and loses every recipient (three times
  over, once the module's retries have run). A single `/notify` now serves a table
  several times larger than it used to. What is shed is still ambient before
  direct — direct goes as a first wave — and still reported (`skipped: 'send
  budget exhausted'`, plus `budgetExhausted: true`) rather than dropped in
  silence. `/status` makes no external call at all, so it answers to the KV
  ceiling and reads up to `MAX_STATUS_USERS` (200) per call; the module chunks
  anything longer.

Recipients are delivered concurrently and each settles independently, so one
recipient's failure no longer aborts the rest of the list. If *every* recipient
failed, `/notify` answers **502** so the module's retry can try again — nothing was
delivered, so a retry cannot double-notify. A partial success stays 200 for the
same reason.

Banners are coalesced by class. Ambient chat collapses into one rolling banner
per (world, user), so ten table messages replace each other rather than stacking
ten notifications. Direct messages stack,
because each is individually addressed, but they collapse *against themselves*:
their `apns-collapse-id` is the chat message's id, so the module re-sending a
`/notify` it never got an answer to shows one banner rather than two. (A
mitigation, not a cure — APNs replaces an undelivered banner, so a duplicate
still appears if the first was already read and dismissed.) A caller that names
no `messageId` gets no collapse id, exactly as before.

Repeated recipient ids are deduplicated before anything is spent on them: a
duplicate would otherwise cost a registration read out of the subrequest budget
to send nothing, and put two delivery runs for one user in flight against each
other's write-back. `droppedRecipients` therefore counts *unique* recipients over
`MAX_RECIPIENTS`, so a payload naming one user 300 times reports one recipient
and no drops.

A registration stores which APNs environment its token belongs to, and the relay
self-heals a wrong one: if APNs answers `BadDeviceToken` / `BadEnvironmentKeyInToken`
it retries the other environment and, on a 200, remembers it. That retry fires
**only** on those two answers, and only a 200 is adopted. A 429, a 5xx or a
connection failure says nothing about the environment — and since a live token is
always `BadDeviceToken` in the environment it *isn't* filed under, probing on a
transient failure and believing the answer used to prune a perfectly good
registration. The device would then stay silent until its next app foreground,
which for a backgrounded phone — the entire audience for push — can be hours.

The module retries a `/notify` that fails transiently (network error, 5xx, 429) up
to three attempts over ~8s. It does not retry other 4xx: a 401 is the wrong world
key and a 400 a bad payload, neither of which a second identical request fixes.

The badge is approximate by construction, and deliberately so. It counts direct
messages only; its read-modify-write is not atomic across concurrent notifies;
KV is eventually consistent; and it resets only when the app next checks in, so
it can briefly over-report whispers already read. Every one of those is a
consequence of keeping it inside the free plan. If an exact count ever matters
more than that, it belongs in a Durable Object — which means the paid plan, where
the subrequest and KV-write ceilings above stop binding too.

`/unregister` takes no bearer: it needs either a module-minted `regToken` or the
`(worldId, userId, deviceToken)` triple — a world's random id plus that device's
own APNs token, both held only by the participating device. It is strictly
subtractive and only ever silences the device whose token is named, so the worst
a leaked triple buys an attacker is stopping pushes to that one device.

## Local dev (optional)

`npm run dev` runs `wrangler dev --remote`, which executes on the edge using the
secrets you already uploaded — so no key file is needed locally and nothing
sensitive lands in this folder. (Run `npm run secrets` first.)
