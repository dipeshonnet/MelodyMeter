# Google sign-in for ratings

Google sign-in is optional and appears only in the song rating form. Google’s script loads after the user chooses “Use Google instead of email”. There is no One Tap prompt, automatic sign-in, or login requirement for browsing. Signing in keeps the scores and asks the user to submit explicitly. The same private 30-day session supports future ratings.

## Configure the Melody Google project

In Google Cloud Console, select **Melody**, then open **Google Auth Platform**:

1. Complete Branding and Audience. Use the MelodyMeter name, your support email, and `everydayai.work` as the authorized domain. Use `https://melody.everydayai.work` for the homepage and `https://melody.everydayai.work/privacy/` for the privacy policy.
2. Under Clients, create an **OAuth client ID** of type **Web application**.
3. Add `https://melody.everydayai.work` to **Authorized JavaScript origins**. For local development, also add `http://127.0.0.1:4321` and `http://localhost:4321`. Origins have no path or trailing slash. This implementation uses the button’s popup callback, so no redirect URI is needed.
4. If the app is in Testing, add the Google accounts used for testing under Audience. Publish for general availability when ready.
5. Copy the client ID ending in `.apps.googleusercontent.com`. No client secret is needed; do not copy one into the frontend.

Official setup: [Google Identity Services client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Enable the API

Add `GOOGLE_CLIENT_ID` to `vars` in `worker/wrangler.jsonc`, using the copied public client ID. For local testing, add `GOOGLE_CLIENT_ID=...` to `worker/.dev.vars`. Keep the existing `EMAIL_HMAC_SECRET` stable so Gmail/Workspace users retain their existing vote identity.

Apply migration `0004_google_login.sql` before deploying the API:

```sh
node scripts/run.mjs wrangler d1 migrations apply melodymeter --remote --config worker/wrangler.jsonc
pnpm deploy:api
pnpm build
pnpm deploy:web
```

For local testing use `pnpm db:local` and restart the API. `/api/auth/google/config` reports whether Google is enabled. The UI hides the option until it is configured. Production vote submission still requires the existing Turnstile setup.

The server verifies Google’s RSA signature, issuer, audience, expiry, verified email, and browser-bound single-use nonce. It stores only the app’s keyed identity and hashed session. It does not store Google credentials, names, photos, or Google access tokens. Gmail and Google Workspace mailboxes share the existing email identity; other Google accounts use a keyed Google subject because Google is not authoritative for those third-party mailboxes. This avoids silently merging those accounts with email-verified votes.

Manual acceptance: choose scores, open Google sign-in, cancel and confirm the scores remain; retry and sign in; confirm the rating is not counted until Submit; submit and update it; confirm one audience vote remains. Also test blocked Google scripts and disabled configuration—the email option remains available.
