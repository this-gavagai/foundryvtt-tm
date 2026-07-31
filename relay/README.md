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

The Worker applies coarse per-minute limits in KV: `/notify` per world — **two
independent buckets**, ambient (60) and direct (60) — and per-IP caps on
`/provision` (20), `/register` (30) and `/unregister` (30). KV is eventually
consistent, so these are approximate ceilings — good against a single hammering
source, but a distributed attacker can exceed them.

The split matters: a message is "direct" when it was whispered to you or names
your username (the module marks those recipients in `/notify`'s `direct` field).
Sharing one bucket meant a combat round's worth of ambient chat on
`pushScope: 'all'` could exhaust the world's budget and silently drop the whisper
that arrived at second 55. When only one class is over limit the other still
delivers, and shed recipients are reported in the response rather than passing as
a successful send.

For a hard, edge-enforced backstop, add a **Cloudflare Rate Limiting rule** (free
tier) in the dashboard: Security → WAF → Rate limiting rules → e.g. match
`http.request.uri.path in {"/provision" "/register" "/unregister" "/notify"}`,
100 requests / 1 min per client IP, action Block. That enforces at the edge
before the Worker runs, closing the eventual-consistency gap.

## Free-plan limits and how the relay degrades

Two Cloudflare free-plan ceilings shape the delivery path, and both used to fail
in ways that cost notifications:

- **KV writes (~1,000/day).** Every `/notify` writes a rate-limit counter plus one
  badge counter per device, so a chatty world on `pushScope: 'all'` can exhaust the
  allowance in a single session. All such bookkeeping now goes through the `kv*`
  helpers, which swallow failures: a push still goes out, it just may not move the
  icon number or enforce the soft rate ceiling. Registration *reads* stay strict —
  not knowing where to send is a real error, and one that the module retries.
- **Subrequests (50/request).** Each APNs send is one, and the environment-retry
  path can double it. `MAX_APNS_SENDS` budgets them at 30, deliberately under the
  ceiling since KV operations may draw on the same allowance. Direct recipients are
  delivered as a first wave, so what gets shed past the budget is ambient chat, and
  shed recipients are reported (`skipped: 'send budget exhausted'`, plus
  `budgetExhausted: true`) rather than silently dropped.

Recipients are delivered concurrently and each settles independently, so one
recipient's failure no longer aborts the rest of the list. If *every* recipient
failed, `/notify` answers **502** so the module's retry can try again — nothing was
delivered, so a retry cannot double-notify. A partial success stays 200 for the
same reason.

The module retries a `/notify` that fails transiently (network error, 5xx, 429) up
to three attempts over ~8s. It does not retry other 4xx: a 401 is the wrong world
key and a 400 a bad payload, neither of which a second identical request fixes.

If the badge count matters more than living inside the free plan, it belongs in a
Durable Object — which means the paid plan.

`/unregister` takes no bearer: it needs either a module-minted `regToken` or the
`(worldId, userId, deviceToken)` triple — a world's random id plus that device's
own APNs token, both held only by the participating device. It is strictly
subtractive and only ever silences the device whose token is named, so the worst
a leaked triple buys an attacker is stopping pushes to that one device.

## Local dev (optional)

`npm run dev` runs `wrangler dev --remote`, which executes on the edge using the
secrets you already uploaded — so no key file is needed locally and nothing
sensitive lands in this folder. (Run `npm run secrets` first.)
