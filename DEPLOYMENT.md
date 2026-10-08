# Cloudflare deployment — 4 October 2026

Google sign-in is now deployed using the Melody project's Web OAuth client ID. Migration `0004_google_login.sql` was applied to production and local D1. API version `d72ac689-61dd-4be9-8a38-8e92b626b12f` and Pages deployment `da8e0f44.melodymeter.pages.dev` include the sign-in flow. The live configuration reports enabled, the start endpoint issues a Secure/HttpOnly browser nonce, and Google's real button renders on a catalog song after the user requests it. Actual account consent and a production rating remain for user acceptance; no test votes were added to production. Local API tests (17), desktop/Android browser checks (4), build, and type checks pass. The installed WebKit browser could not launch, so iPhone verification remains pending. Email delivery remains unconfigured, but Google sign-in provides the rating verification option.

Public PWA: https://melody.everydayai.work
Pages fallback: https://melodymeter.pages.dev
Worker: melodymeter-api; Pages project: melodymeter; D1: melodymeter (APAC).
Database UUID: 8896068d-2e1b-478b-ab30-bdc31153a7b5.

The account remains on the Workers Free plan. No upgrade or paid fallback was enabled. The custom domain's CNAME points to melodymeter.pages.dev and Cloudflare reports domain and certificate validation active. Pages Functions forwards `/api/*` through the Worker service binding. Both database migrations were applied remotely. Turnstile, production HMAC/admin secrets, AI binding and minute cron are configured. Secrets are in the ignored deployment-secrets.local.json file; never publish that file.

The hosted catalog now contains 27 selected MusicBrainz recording identities (17 Hindi, 10 English), all with saved Workers AI estimates under comfortable-melody-v3. Twenty-one overall estimates are at least 7/10. Twelve recordings were added during ease calibration. The easy-song view is https://melody.everydayai.work/?ease=easy. This is not the promised 1,000-song launch. Small-model estimates remain subjective and need comparison with community ratings. Metadata release years describe selected MusicBrainz releases and may differ from a song's original release year.

Live inference exposed reversed ease scores and a collapsed distribution. Revision 3 uses independent qualitative factor classifications and converts them to ease scores in application code. See CALIBRATION.md for the method, comparison results and shortlist sources. Explicit replacement archives prior assessments atomically; failed attempts preserve the previous score. Audience votes were not modified. Generation attempts and previews remain charged against the application's capped free neuron allowance; after this update the day's reservations total 4,281 of the 8,000-neuron application cap.

Resend is not configured. Email voting is unavailable and the PWA states that clearly while preserving score drafts. To enable it, verify mail.everydayai.work in Resend, add its supplied DNS records, and configure RESEND_API_KEY as a Worker secret. Do not paste keys in chat. Keep the Resend account on Free and prevent paid upgrades.

Production build (34 pages), Astro check, Worker type check and all 16 API tests passed, including score direction, preview quotas, atomic recalibration and preservation of votes. Physical-device PWA acceptance and real email delivery remain pending. The 500-Hindi/500-English launch check intentionally remains unsatisfied.

Redeploy API with `node scripts/run.mjs wrangler deploy --config worker/wrangler.jsonc --autoconfig=false`. Existing secrets are preserved. Redeploy web with `node scripts/run.mjs wrangler pages deploy dist --project-name melodymeter --branch main` after rebuilding. Use the project wrapper to retain the local OAuth configuration.
