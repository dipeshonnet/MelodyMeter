# Account saved songs

Saved songs are stored in Cloudflare D1's `saved_songs` table, keyed by the same protected account identity used for ratings. Each account/song pair is unique. Google sign-in or email verification establishes the session used by the private API; no readable email or Google profile is stored.

`GET /api/saved-songs` returns the current account's list and song metadata. `POST /api/saved-songs` applies up to 50 add/remove changes. Requests require a valid session; writes also require the app origin and the opaque account identifier returned by GET, so queued changes cannot be applied to a different account.

Existing device bookmarks import when the user signs in. Account lists and pending offline changes are stored separately in the browser. Reconnection, page load, or a new sign-in triggers synchronization. A fresh browser restores the saved list from D1. Removing a song updates only that account's saved list and does not remove ratings.

Migration `0005_saved_songs.sql` has been applied locally. Production rollout requires applying this migration to the remote `melodymeter` database before deploying the API and rebuilt frontend:

```powershell
node scripts/run.mjs wrangler d1 migrations apply melodymeter --remote --config worker/wrangler.jsonc
node scripts/run.mjs wrangler deploy --config worker/wrangler.jsonc --autoconfig=false
node scripts/run.mjs astro build
node scripts/run.mjs wrangler pages deploy dist --project-name melodymeter --branch main
```

The local implementation does not change the deployed website until that rollout is performed.
