# Verification record

## Catalog performance refactor — 8 October 2026

Catalog search, filtering, and sorting now use a browser-independent `SongCatalog` index in `shared/catalog.ts`. Search text is normalized once per recording, ID lookups use maps, and sorted orders are reused until recordings or relevant scores change. The browser reads rating snapshots once, batches added cards, and moves cards only when their order changes. Storage events refresh cached audience scores across tabs. Favorite membership checks use sets.

Astro diagnostics passed with zero errors, warnings, or hints; Worker TypeScript passed; the production build generated 332 pages. All 28 unit/API tests passed, including six new catalog regressions. Four browser checks passed across desktop Chromium and Android Chrome emulation, covering indexed search, language/decade filtering, community-score updates, duplicate incoming recordings, saving new recordings, account migration, and offline removal sync. The catalog regression verifies zero additional rating-storage reads and zero grid child-list mutations during filtering with an unchanged sort order. These are operation-count checks, not an end-to-end timing benchmark.

Both iPhone/WebKit checks failed before test execution because the installed WebKit process exited during startup. Safari behavior remains unverified for this refactor. The older starter-catalog browser suite was not rerun because its fixed catalog counts and song paths are obsolete. Changes were built locally and have not been deployed.

## Decade expansion — 4 October 2026

The live catalog now contains 325 distinct MusicBrainz recording identities: 164 Hindi and 161 English songs. Coverage is at least 20 songs per language in each decade from the 1950s through the 2020s. Hindi has 21 in the 1990s and 23 in the 2010s; English has 21 in the 2000s. All other language/decade groups have 20. The 298 new entries have no numerical assessments; all 27 existing saved AI estimates and 82 curated practice links are preserved. New entries use explicitly labeled song-specific practice searches until direct links are curated.

Catalog checks passed for unique identities, duplicate titles, release-year bounds, sixteen coverage groups, all 325 pre-rendered song pages, and secure direct/search practice links. Astro diagnostics passed (20 files, zero errors, warnings, or hints). The production build generated 332 pages. All 16 SQLite/API tests passed. The full historical browser suite was not rerun; it contains obsolete starter-catalog counts and paths.

Cloudflare D1 metadata import completed, changing the song count from 27 to 325 while preserving 27 assessments and zero votes. No AI generation jobs were queued and no paid services were enabled. Pages deployment `7e8e0531.melodymeter.pages.dev` is live on the custom domain.

Live browser checks verified every language/decade combination and its visible card count, a new song page after API hydration, clear pending factor scores and practice-search labels, a shareable decade URL surviving reload, and save/unsave behavior with the original favorites state restored. The browser viewport had equal document/client widths of 659 pixels. Evidence: `artifacts/decades-live-check.json`, `artifacts/decade-check.json`, and `artifacts/decades-live.png`. Original release years are curated separately from MusicBrainz compilation dates; exact soundtrack first-publication dates and singing difficulty are not established by these checks. Physical Android/iPhone acceptance was not repeated.

## Song resource links — 4 October 2026

All 27 catalog songs have researched lyrics, original audio/video, and karaoke links (82 links including a labeled Bob Dylan live video). Public page and YouTube metadata checks succeeded for all 82 after replacing unavailable/restricted metadata links. Checks confirmed the named singers/versions and actual upload channels. All 27 generated pages contain their exact links and secure new-tab attributes. Astro diagnostics passed (20 files, no errors/warnings/hints); the production build generated 34 pages. Ratings and voting code were not changed. See SONG_LINKS.md and `artifacts/song-resource-check.json` for resource curation and availability evidence.

The resource update was deployed to Cloudflare Pages (`038e1e42.melodymeter.pages.dev`) and verified on the custom domain. Live browser checks confirmed card-artwork navigation, separate save/unsave behavior (original favorites state restored), Hindi and English resource sections, and resource rendering on the dynamic song page after API hydration. Links carry new-tab targets; the rating page remained open during a lyrics-link click. Screenshot: `artifacts/song-links-live.jpg`. Full media playback and physical-device acceptance were not tested.

## Ease calibration verification — 4 October 2026

All 16 SQLite/API tests passed, including qualitative-to-ease conversion, quota-limited non-persisting previews, and explicit recalibration that archives AI scores while retaining audience votes. Invalid AI output leaves the previous rating intact. Worker TypeScript and Astro diagnostics passed (19 files, zero errors/warnings). Production build generated 34 pages for the expanded catalog.

Live Workers AI comparison separated Stand by Me (preview 9), Bohemian Rhapsody (3), and Tum Hi Ho (7). Saved generation then completed for all 27 recording identities under rubric revision 3; 21 overall scores qualify as easy. Saved Stand by Me is 8, reflecting a separate generation from the preview; subjective model estimates are not exact measurements. All nine factors validate as integers and overall values are computed in code. Twelve additional recording identities were reviewed before importing. Prior assessments were archived and audience votes were not edited. No paid fallback was enabled; daily AI reservations remain below the application cap.

## Cloudflare verification — 4 October 2026

Live browser verification of the updated easy-song shortcut showed 21 songs with Easy · 7–10 and Easiest first selected. Language filters returned 14 Hindi and 7 English songs. Screenshot: `artifacts/easy-songs-live.jpg`. A supplementary remote database count query timed out; this does not replace the passing transactional tests or completed generation/export checks described above.

Production Astro build and diagnostics passed (19 files, zero errors/warnings). Worker TypeScript passed. All 13 API tests passed again after the scoring calibration change, including rejection of clearly contradictory ease scores. Worker bundle build and actual deployment succeeded. The deployed PWA serves 22 static pages for 15 canonical recordings; 12 have saved real Workers AI estimates and three failed validation after bounded retries. Earlier AI assessments were archived before regeneration. Cloudflare domain and HTTPS validation are active, the account is on Workers Free, and the Pages API service binding responds successfully. Live search and a song detail page were checked in the browser. See DEPLOYMENT.md for current configuration and outstanding dependencies.

Email delivery, the 1,000-song launch, broader AI quality calibration, and physical-device PWA acceptance remain pending. The complete browser suite was not rerun against production.

## Historical local verification — 3 October 2026

## Completed checks

- Astro diagnostics: 19 files, zero errors, warnings, or hints at the last successful check.
- Worker TypeScript compilation: passed at the last successful check.
- Core SQLite/API tests: all **12 original tests passed**. These execute the real migration, triggers, token confirmation, voting, quotas, and AI job code.
- Static Astro production build: succeeded, generating 39 pages for the starter app and its 32 song pages, public icons, compiled bundles, and an offline asset manifest.
- Browser scenarios: **all 12 scenarios passed across separate targeted runs** after fixes, covering desktop Chromium, Android Chrome emulation, and iPhone WebKit emulation. They verify search/filtering, favorites, responsive widths, sharing/install UI, explicit email confirmation and vote replacement, and offline public reads. This is not a claim that a final single full-suite rerun passed.
- WebKit offline cache fallback: passed by shutting down an isolated static origin, avoiding Playwright's documented offline-emulation defect. No application cache response was mocked.

Browser verification caught and fixed the local mailbox's ambiguous SQL ordering, missing shared JavaScript in the offline cache, public asset matching with preview response headers, and stale dependency caches caused by running development and build together.

## Final rerun pending

After the passing runs, small changes adjusted community-score badge fallback, saving during initial service-worker activation, offline cache capacity, provisional estimate wording, and choosing the canonical catalog when exported. A combined local startup helper and an additional mailbox regression test were also added. These final changes have **not** been rerun through the complete checks. The suite now contains 13 API tests; only the original 12 have executed successfully.

Automatic approval review could not execute the final code/test rerun or production Worker dry-run bundle check because the Codex workspace had exhausted its review credits. This was a review-service failure, not an unsafe-action determination. The user chose to finish with the existing results. No deployment was attempted.

To complete validation later, follow README.md and run:

```sh
pnpm check
pnpm test
pnpm build
pnpm test:browser
node scripts/run.mjs wrangler deploy --dry-run --outdir artifacts/worker-build --config worker/wrangler.jsonc
```

The browser suite needs the local API at 8787, frontend at 4321, and built preview at 4322. See README.md for the WebKit dependency-detection workaround used on this Windows host.

## Launch dependencies still outstanding

- Cloudflare and Resend accounts, actual D1 UUID, production secrets, Turnstile keys, sender DNS verification, and custom-domain publication.
- A curated canonical catalog and saved model estimates for **500 Hindi and 500 English recordings**. The local starter has only 32 provisional estimates and is not certified as the production launch catalog.
- Real provider delivery and AI inference checks. Local verification uses captured test messages and mocked AI in unit tests; no actual email or hosted AI call has been made.
- Physical Android/iPhone installation and offline acceptance checks after HTTPS deployment. Browser device emulation is not a physical-device test.

`pnpm launch:check` deliberately rejects the current incomplete catalog and placeholder production database configuration.
