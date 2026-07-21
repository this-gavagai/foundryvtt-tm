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

## Abuse controls

The Worker applies coarse per-minute limits in KV: `/notify` per world (60), and
per-IP caps on `/provision` (20) and `/register` (30). KV is eventually
consistent, so these are approximate ceilings — good against a single hammering
source, but a distributed attacker can exceed them.

For a hard, edge-enforced backstop, add a **Cloudflare Rate Limiting rule** (free
tier) in the dashboard: Security → WAF → Rate limiting rules → e.g. match
`http.request.uri.path in {"/provision" "/register" "/notify"}`, 100 requests /
1 min per client IP, action Block. That enforces at the edge before the Worker
runs, closing the eventual-consistency gap.

## Local dev (optional)

`npm run dev` runs `wrangler dev --remote`, which executes on the edge using the
secrets you already uploaded — so no key file is needed locally and nothing
sensitive lands in this folder. (Run `npm run secrets` first.)
