# MelodyMeter

An Astro + TypeScript PWA that rates **ease of singing**. Higher is easier. The main lead melody is judged in a comfortable key; there is no playback, audio upload, or claim of audio analysis.

The deployed catalog contains 325 songs (164 Hindi, 161 English), with at least 20 per language in every decade from the 1950s through the 2020s. Use the decade dropdown alongside language and difficulty filters. Existing estimates are preserved; 298 new entries await assessment. See [DECADE_CATALOG.md](DECADE_CATALOG.md) for metadata provenance and the expansion workflow.

## Run locally without accounts

Requirements: Node.js 22.13+ (Node 24 recommended), pnpm, Windows/macOS/Linux. All generated local configuration is ignored by Git.

```sh
pnpm install
pnpm setup:local
pnpm db:local
```

Start the API in one terminal:

```sh
pnpm api:dev
```

In another terminal, seed the database and start the app:

```sh
pnpm seed:local
pnpm dev
```

Open **http://127.0.0.1:4321**. Use this exact address: local verification links and the origin check are configured for it. The API runs on 8787; Astro proxies `/api` to it.

After installing dependencies, `pnpm start:local` runs setup, migrations, seeding, and both servers together. Use it when no frontend is already running on 4321. Stop it with Ctrl+C.

The local configuration has no Workers AI binding, sends **no real emails**, and makes **no paid calls**. New-song identity searches optionally access the public MusicBrainz API. Missing AI estimates wait until the hosted service is configured. Provisional estimates already in the app work immediately.

Try a vote: choose an overall score, optionally choose factors, enter a test email, submit, open **Local test inbox**, open the newest link, review the pending scores, and press **Confirm rating**. The link preview does not count a vote. Confirmation sets a verified session for 30 days. You can then update your vote or rate other songs without another email.

Local mail URLs contain private test tokens. They are accessible only on the loopback development API and never appear in production. Do not expose the development servers to the internet. The local HMAC key is generated automatically and is never printed.

For a production-style offline preview:

```sh
pnpm build
pnpm preview --port 4322
```

Open http://127.0.0.1:4322 for **read-only offline checks**. Voting uses the configured 4321 origin. The service worker is enabled in built previews; it is disabled during Vite development to prevent stale development modules. Install the app or save a song while online, then revisit it offline. Installation prompts depend on the browser: Chrome offers an install action; Safari uses Share → Add to Home Screen.

## What is implemented

Optional Google sign-in for ratings is configured using the Melody Google project. See [GOOGLE_LOGIN.md](GOOGLE_LOGIN.md) for setup. It loads only when chosen in the rating form, preserves score drafts, and requires explicit submission after sign-in.

- Search by title, artist, film, aliases, or Hindi script; filter Hindi/English, ease, and favorites; sort by ease or title.
- Nine understandable singing factors and weighted, rounded AI overall scores.
- Separate AI and audience scores, ten-vote qualification overall and independently per factor.
- Favorites and rating snapshots on the device, sharing, manifest/icons, offline public pages and JavaScript bundles.
- Mailbox verification, explicit confirmation, hashed tokens, keyed email identifiers, unique recording/email votes, secure production sessions.
- Atomic vote changes and aggregate updates using D1/SQLite transactions and triggers.
- Turnstile verification, send/rate limits, reserved AI budgets, deduplicated persistent jobs, automatic retries, insufficient-information results, expiry cleanup, private problem reporting.
- Cached, centrally throttled MusicBrainz metadata lookup; canonical recording IDs for the launch import.
- Cloudflare Pages → service-bound Worker API → D1 / Workers AI / Resend, with configuration for **melody.everydayai.work**.

## Catalog status and the 1,000-song launch

The fallback starter source contains **32 songs: 16 Hindi and 16 English**, with provisionally authored assessments. The current exported hosted catalog takes precedence: **27 canonical recordings with 27 saved Workers AI estimates**, including 21 overall scores of at least 7/10. Local seeding follows the selected catalog. No community votes are fabricated. See DEPLOYMENT.md and CALIBRATION.md for current coverage, score calibration and assessment limitations.

The requested 1,000-song launch catalog has **not been generated yet**. It requires a Cloudflare account and explicitly selected canonical recordings. `data/launch-catalog.json` is currently empty. `pnpm launch:check` fails until exactly 500 Hindi and 500 English recordings with saved results from the configured model are present, and a real production D1 database is configured. It deliberately cannot certify the starter catalog as launch-ready.

Use the following resumable workflow after account setup. Set `MELODYMETER_API` to the hosted API URL, `MELODYMETER_ORIGIN` to `https://melody.everydayai.work`, and `MELODYMETER_ADMIN_SECRET` locally. The administrator credential is a server secret, never a public frontend environment variable. Do not paste keys into chat or put them in import files.

1. Curate 500 Hindi and 500 English **recordings**, selecting original studio versions in MusicBrainz. Popularity is an editorial selection; core metadata does not establish popularity or vocal difficulty. If a model cannot assess one, select an alternative recording/song rather than invent a rating.
2. Save a JSON array of candidates in `data/imports/candidates.json`. Each entry has `musicbrainzId` (real recording UUID), `title`, `artist`, `language` (`Hindi` or `English`), `version`, and optional `album`, `year`, `aliases`. Recording identities must be unique. Choose versions explicitly; the importer does not guess the first search result.
3. Import identities, then enqueue generation:

```sh
pnpm catalog:import data/imports/candidates.json
pnpm catalog:enqueue
pnpm catalog:status
```

Imports share the API's central throttle and cache. Repeating an import or enqueue does not duplicate saved ratings or votes. A cron invocation processes one job each minute and pauses when the conservative daily budget is reached. The launch may take several days on Free. The model can return insufficient information; the status command shows incomplete jobs. No audio or exact BPM/range measurements are inferred from MusicBrainz metadata.

4. Once enough usable results exist:

```sh
pnpm catalog:export --require-launch-target
pnpm launch:check
pnpm build
```

Export copies permanently saved results into the static catalog so initial song pages remain available during API outages. Only the initial catalog needs pre-rendering. New recordings remain addressable at `/song/?id=...`, are searchable through the API, and can be saved offline. Re-export and rebuild periodically to include them in the static launch catalog.

Local `starter:` IDs are for demonstration. Production launch entries use `mb:<recording UUID>`; do **not** import local test votes into production. This keeps versions and votes tied to an actual recording.

## Publish later to melody.everydayai.work

This repository is prepared for Cloudflare. Nothing has been deployed and no accounts have been created.

1. Create **Cloudflare Workers Free** and **Resend Free** accounts. Keep paid subscriptions, paid fallback models, and pay-as-you-go disabled. Domain registration/renewal is separate.
2. Sign in locally with `node scripts/run.mjs wrangler login`.
3. Create D1: `node scripts/run.mjs wrangler d1 create melodymeter`. Put its returned UUID into `worker/wrangler.jsonc` (production only). Apply the migration with `node scripts/run.mjs wrangler d1 migrations apply melodymeter --remote --config worker/wrangler.jsonc`.
4. Create a free Turnstile widget for `melody.everydayai.work`. Put its public site key in `.env` as `PUBLIC_TURNSTILE_SITE_KEY`. Keep `SITE_URL=https://melody.everydayai.work`.
5. Verify the sending subdomain **mail.everydayai.work** in Resend. Add the exact DKIM/SPF DNS records Resend gives you; do not invent DNS values or replace an existing SPF record blindly. Configure `MAIL_FROM` accordingly. Disable tracking for verification links and leave paid overages off.
6. Configure production secrets using `node scripts/run.mjs wrangler secret put NAME --config worker/wrangler.jsonc`: `EMAIL_HMAC_SECRET` (random 32+ bytes), `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `ADMIN_SECRET` (random 32+ bytes). Keep the HMAC key stable: changing it changes voter identities. Never configure `DEV_MODE` on the hosted Worker or deploy the local config.
7. Deploy the API with `pnpm deploy:api`. Its cron and AI binding are in the production configuration. Use a temporary protected admin import URL through the Worker for the catalog pipeline. Deployed browser votes use the final same-origin Pages API, not a cross-origin Worker URL.
8. Complete the launch catalog, run `pnpm check`, `pnpm test`, `pnpm launch:check`, then `pnpm build`.
9. Create Pages project `melodymeter`, then `pnpm deploy:web`. `wrangler.jsonc` binds the API service `melodymeter-api`. Pages Functions forward `/api/*` to that service without a public browser API key.
10. Add **melody.everydayai.work** through Pages → Custom domains and follow its DNS instructions. Add the domain in Pages before setting a CNAME. Confirm HTTPS, sender DNS, Turnstile, confirmation emails, and production secure cookies on that domain. `APP_ORIGIN` is already set to it.

API deployments may begin before catalog completion, but the 1,000-song public launch is gated by the readiness check. Deploying the code alone does not provision provider accounts, verify sender DNS, or create catalog ratings.

Current source references for setup: [Cloudflare Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/), [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Resend pricing](https://resend.com/pricing), [sender domain setup](https://resend.com/docs/dashboard/domains/introduction), [MusicBrainz rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting), and [metadata licensing](https://musicbrainz.org/doc/About/Data_License).

## Score and privacy rules

Weights: singing speed 15%, pitch range 20%, note jumps 15%, held notes 10%, breathing room 10%, rhythm/timing 10%, vocal runs 10%, stamina 5%, section changes 5%. AI factors are integers, and the application computes the rounded weighted mean.

Audience overall is required; factors are optional and are never filled with AI values. Equal-weight means are shown to one decimal only after ten verified votes for the relevant overall or factor. The audience overall comes from overall submissions, independently of factor means. Invalid vote removal immediately rebuilds aggregates; counts below ten revert to AI primary. Ten votes are a publication threshold, not a claim of certainty.

Email trim/lowercase → HMAC-SHA256 identifier; one active row per recording/identifier. Updates replace all previous selections including skipped factors. Pending changes never modify a counted vote. Single-use 30-minute tokens are hashed and bound to the exact saved scores and recording. Fragment links keep tokens out of server request URLs; opening a link does not submit. Confirmation batches insert/update a vote, issue a server-side 30-day session, and consume the token atomically. Production cookies are Secure, HttpOnly, SameSite=Lax.

The app does not store raw recipient email, add subscribers, or expose voter identities in public responses. Resend receives the email for delivery and has its own delivery records. Feedback is private. Expired pending submissions and sessions are cleaned by the scheduler; no API, verification, or local mailbox response is cached by the service worker. Favorites and score-only drafts stay in local storage. Clearing browser storage removes them. Mailbox access is verified; a person with multiple emails can still cast multiple votes.

## Cost controls

The selected model is allowlisted. Each attempt reserves conservative worst-case input/output neurons using the current model rates, including retries, before calling AI. Daily reservations cannot exceed **8,000 neurons**; budget exhaustion queues work until 00:00 UTC. Reservations are not refunded, protecting against retry overruns. Recheck provider rates if changing models or deploying much later. A shared Cloudflare account's other AI usage is outside this application's budget.

Email attempts stop at **90/day**, **2,700/month**, **one per 60 seconds**, and **three per email per hour**. An additional IP/hour limit reduces abuse. Failures retain the user's score draft; responses include a retry date. Already verified sessions do not consume email allowance. Provider Free limits also fail closed; the code has no paid fallback or automatic upgrade. Traffic can still exceed Workers/D1 Free limits, in which case the live API may be unavailable while static pages remain accessible.

## Verification

See [VERIFICATION.md](VERIFICATION.md) for passing checks and [DEPLOYMENT.md](DEPLOYMENT.md) for the live Cloudflare setup. Resend integration and the 1,000-song launch remain incomplete.

```sh
pnpm check
pnpm test
node scripts/run.mjs @playwright/test install chromium webkit
pnpm test:browser
```

The API test suite runs the **actual migration and aggregate triggers** against SQLite, and exercises the Worker routing and voting code. Browser checks expect the frontend at 4321, the API at 8787, and a built preview at 4322. They create local-only test ratings; these never become production votes. Browser artifacts and traces are ignored by Git. Tests cover desktop Chromium, Android Chrome emulation, and iPhone WebKit emulation; actual physical-device installation remains a launch acceptance check.

WebKit's offline check stops an isolated local static server to exercise real network-failure cache fallback. It avoids a [Playwright 1.63 offline-emulation bug](https://github.com/microsoft/playwright/issues/42775). On Windows, dependency detection can incorrectly report the included WebKit DLLs missing; if they are present and the browser launches, set `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` before the browser test command. This only bypasses dependency detection, not the tests.

Useful directories: `src/` PWA, `shared/` rubric/types, `worker/src/` API/security/jobs, `migrations/` D1 schema, `scripts/` local setup/catalog tooling, `tests/` API and browser tests, `data/` starter and launch catalog.
