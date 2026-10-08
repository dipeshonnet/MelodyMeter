# Catalog coverage by decade

The catalog covers the 1950s, 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, and 2020s, with at least 20 distinct Hindi songs and 20 distinct English songs in each decade. The 2020s are an ongoing decade. The minimum requested coverage is 320 songs.

`data/decade-selections.json` records curated song, singer, original release year, and film/album selections, including reserve choices. `data/launch-catalog.json` contains selected MusicBrainz recording identities and preserved assessments. `data/decade-provenance.json` separates curated original release years from the earliest release attached to a selected recording in MusicBrainz. Missing and later compilation dates in MusicBrainz must not be presented as original song dates. Some curated years use the original film release year; this is not a claim that the soundtrack's exact first publication date has been exhaustively verified.

Public recording searches are cached and throttled. Selection considers song title, credited singer, original film/album, and earliest release date, and excludes explicit live performances, remixes, karaoke, demos, and remakes. A second pass reviews questionable matches against releases from the original decade. Existing assessment identities are retained, so favorites, shared URLs, direct practice links, and audience votes remain connected to the same recordings.

New catalog entries have **no invented singing score**. The existing 27 saved AI estimates remain visible and unvalidated by audio analysis. A catalog identity or release year provides no evidence about vocal range, breathing, or any other singing difficulty factor. Missing assessments are marked pending; optional on-demand AI estimates still have the existing audio-not-analyzed disclosure.

The decade dropdown combines with language, difficulty, favorites, and search. `decade` and `language` URL parameters make filtered browsing shareable. Unrated songs are excluded from numerical difficulty filters. All song pages are pre-rendered; visited/saved public pages retain existing offline behavior.

Validation and publication commands:

```sh
node scripts/expand-decades.mjs
node scripts/finalize-decades.mjs
node scripts/review-decade-recordings.mjs
node scripts/check-decades.mjs
node scripts/run.mjs astro check
node scripts/run.mjs astro build
node scripts/check-decades.mjs --built
node scripts/check-song-resources.mjs --built
node scripts/publish-decades.mjs
node scripts/run.mjs wrangler pages deploy dist --project-name melodymeter --branch main
```

The publication helper updates only song metadata in D1 and verifies that AI assessment and audience vote counts remain unchanged. It does not queue generation jobs, send email, change plans, or enable paid services. The requested decade coverage is separate from the earlier unfinished 1,000-song, fully rated launch target.

Metadata references: [MusicBrainz recording search](https://musicbrainz.org/doc/MusicBrainz_API/Search/RecordingSearch), [MusicBrainz API requirements](https://musicbrainz.org/doc/MusicBrainz_API), [Saregama song catalog](https://www.saregama.com/regional/hindi_6/song/top).
