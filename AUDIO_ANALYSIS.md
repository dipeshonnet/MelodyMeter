# Sound analysis

## Complete automated estimates

The complete-estimate workflow implements the user's choice to publish all nine
factors as **low-confidence acoustic estimates**. It does not turn the partial
measurements into validated singing judgments. Complete estimates are saved in
`data/full-audio-estimates.json`, separately from partial measurements, AI song
knowledge, and audience votes. Their overall is the existing weighted nine-factor
ease score. Qualified community ratings take precedence over complete audio
estimates; audio estimates take precedence over AI knowledge estimates.

```sh
node scripts/analyze-youtube-catalog.mjs --complete-estimates
node scripts/analyze-streaming-catalog.mjs
node scripts/run.mjs tsx scripts/import-complete-audio.ts
```

Both runners need `MELODYMETER_AUDIO_PYTHON`. The YouTube runner covers all 325
catalog entries. The streaming runner uses the public Monochrome search and
playback endpoints documented by its official client and checks the 29 entries
without supported prior YouTube measurements by default. `--all` broadens it to
the entire catalog; `--discover-only` checks metadata without retrieving audio.
Requests require title, all credited artists (including narrowly reviewed
spellings), and full-duration agreement. No credentials, login cookies, human
verification bypass, or DRM extraction are used. Full stream downloads are
temporary and limited to 150 MB. Reports checkpoint independently in
`artifacts/complete-audio-analysis.json` and `artifacts/streaming-audio-analysis.json`.
`--retry-unavailable` revisits incomplete rows; `--force` repeats selected rows.

Complete estimates use foreground pYIN at 0.25-semitone resolution, with probability at least 0.35
and an RMS energy gate. Separately reported **confident** pitch seconds retain
the partial workflow's threshold of 0.75. These probabilities describe pitch
periodicity, not vocal identity or rating accuracy. A complete estimate requires
at least ten tracked seconds and 3% coverage, twenty sustained pitch events,
ten connected nonzero pitch movements, five activity phrases, sixteen detected
beats, three supported temporal blocks, and two adjacent block comparisons.
Missing evidence produces a partial result, never an automatic easy score.

| Factor | Acoustic proxy | Difficulty cutoffs (greater is harder) |
| --- | --- | --- |
| Speed | 90th-percentile pitch-event rate per tracked second in 10-second windows | 1, 2, 3, 4 |
| Range | 5th–95th percentile tracked pitch span, semitones | 7, 12, 17, 24 |
| Jumps | 90th-percentile connected event pitch change, semitones | 2, 4, 7, 10 |
| Held notes | Longest smoothed pitch event, seconds | 1.5, 3, 5, 8 |
| Breathing | 90th-percentile detected activity-phrase duration, seconds | 3, 5, 8, 12 |
| Timing | Fraction of event entrances away from an estimated eighth-note grid | .15, .3, .45, .6 |
| Runs | Distinct rapid directional pitch passages per tracked minute | 1, 3, 8, 15 |
| Stamina | Total detected activity, minutes | 1, 2, 3, 4 |
| Changes | Fraction of adjacent supported 30-second blocks with substantial pitch-centre/spread changes | .15, .3, .5, .75 |

The five bands map to 9/8/6/4/2 and are **unvalidated heuristic thresholds**.
Pitch events are median filtered and last at least 96 ms; connected movements
do not bridge gaps over 160 ms. Activity detection uses probability 0.5 and
bridges gaps up to 350 ms. A rapid passage needs at least three small steps in
the same direction; alternating vibrato and overlapping triples do not count
as separate passages. Temporal blocks need two tracked seconds. Changes mean
at least three semitones in pitch centre or five semitones in pitch spread.

Words, syllables, actual breaths, physiological effort, and section identities
are not measured. Instruments and backing voices can survive foreground
separation. This makes the speed/runs/breathing/timing/stamina/changes scores
especially uncertain. Every factor displays its observation, limitations, and
low confidence; the page distinguishes low-threshold tracking from confident
samples and links the source recording. These are provisional estimates,
not listening-reviewed or calibrated assessments.

Optional neural separation is available with `--neural-vocals`. Install
`onnxruntime==1.23.2` without dependencies into `artifacts/audio-neural` and save
the publisher's `UVR-MDX-NET-Voc_FT.onnx` and hash-indexed `model_data.json`
in `artifacts/audio-models`. The implementation verifies the model's stem
identity and parameters against its publisher metadata. It operates at 44.1
kHz stereo before 8 kHz pitch analysis. `MELODYMETER_VOCAL_BACKEND=dml` uses
`onnxruntime-directml==1.23.0` installed separately in `artifacts/audio-dml`;
the requested provider must activate rather than silently falling back.
Neural separation was computationally expensive on the available machine;
the default batch uses the faster foreground approximation. Neither method
verifies lead singer identity or calibrates the difficulty bands.

Source discovery included the user-provided [FMHY audio list](https://fmhy.net/audio).
Monochrome's [public client](https://github.com/monochrome-music/monochrome/blob/main/js/tracks-api.js)
documents its search and playback endpoints. [Octave](https://octavestreaming.com/)
currently states that access requires Discord membership; it is not an
unattended public source in this workflow. Live performances, remixes, and
different artist recordings are excluded from original-studio matching.

## Partial measurements

The hosted catalog's existing assessments use song knowledge, not audio. This
separate resumable preview workflow processes songs without those assessments;
the full YouTube workflow covers every catalog song, including already rated songs.

`scripts/analyze-public-previews.mjs` searches public preview metadata with
conservative title and credited-artist matching, rejects explicit alternate
versions, and streams the selected excerpt into Python. Audio bytes stay in
memory and are not redistributed or saved. Source URLs and matched metadata
are retained in the report. Matching metadata does not verify equivalence to
the catalog's canonical MusicBrainz recording.

Install `librosa==0.11.0` and `imageio-ffmpeg==0.6.0` into
`artifacts/audio-python` using Python 3.12. Set `MELODYMETER_AUDIO_PYTHON` to
that Python executable, then run:

```sh
node scripts/analyze-public-previews.mjs
```

An optional numeric argument limits new analyses. The report checkpoints after
each song in `artifacts/public-preview-analysis.json`. Re-running resumes it;
request and analysis failures are retried. Missing matches and insufficient
pitch evidence remain unscored. Existing assessments and community votes are
never changed.

The analysis uses approximate REPET-SIM foreground separation and probabilistic
YIN pitch tracking. It records duration, confident pitch coverage, pitch span,
adjacent pitch movement, and stable-pitch duration. Instruments and backing
vocals can survive separation. Confidence refers to periodic pitch detection,
not to whether that pitch belongs to the main singer.

Partial factors use the same pitch-confidence threshold (0.75), with at least
two seconds of confident samples and sufficient foreground energy for a sampled
range estimate. A held-note proxy additionally needs an observed stable pitch
of at least 1.5 seconds. Missing observations do not imply easy singing.
Bands map to 9/8/6/4/2; cutoffs are unvalidated heuristics in the analyzer.
No overall is computed, and no values are invented for unmeasured factors.

After analysis, run `node scripts/run.mjs tsx scripts/import-partial-audio.ts`
to validate and save supported partial factors into `data/audio-assessments.json`.
The frontend and API share that file. Cards identify partial coverage; detail
pages show factor scores, missing factors, sample coverage, source links, and
limitations separately from AI and audience scores. Build and deploy both the
frontend and API to publish an update. Overall filters still use full AI or
qualified audience ratings only. These partial sound estimates are not verified
lead-vocal measurements or full-song singing ratings.

Set `MELODYMETER_AUDIO_SONGS` to comma-separated catalog song IDs to reanalyze
specific songs. The report checkpoints independently from published data.
Listening review, recording verification, better vocal separation, and
representative full-song evidence are needed before completing ratings.

For full YouTube recordings, install `yt-dlp[default]` into
`artifacts/youtube-python`, set the Python environment variable above, and run:

```sh
node scripts/analyze-youtube-catalog.mjs
```

The whole-catalog runner first checks previously curated links, then searches
verified uploaders. Search matches require the title and all credited artists
in the upload metadata and reject explicit alternate versions. Artist-name
aliases cannot substitute for a song title; reviewed alternate title spellings
are retained with source links in `data/audio-title-aliases.json`. It obtains the
canonical recording duration from MusicBrainz, following verified recording-ID
merge redirects and checking release-track durations for the exact recording
when the recording-level duration is missing. If MusicBrainz has no usable
duration or returns a missing recording, matched Apple release metadata can
provide a duration reference. That match requires the song title and all
credited artists, excludes alternate versions, and is explicitly marked as
unverified equivalence to the canonical recording. References are cached in
`data/song-durations.json`. The runner rejects shortened music videos. Accepted uploads
must be within 4% or eight seconds below that duration, and within 40% or sixty
seconds above it to allow video intros and outros. Decoded audio must also agree
with the upload duration within three seconds. These checks do not establish
that two recordings are identical or that every detected pitch is a lead vocal.
During a retry, if no upload matches the canonical duration, a matched Apple
studio-release duration can also be checked. Accepted alternate references are
recorded alongside the YouTube source in the full-analysis report.

The runner retrieves audio without login cookies, analyzes up to 15 minutes in
bounded separation windows, deletes its temporary audio, and checkpoints each
song in `artifacts/full-song-analysis.json`. Matched source links are saved in
`data/full-song-sources.json`. Three concurrent jobs process the catalog by
default; `MELODYMETER_AUDIO_CONCURRENCY` accepts one to six jobs. Resume
by running the same command; use `--retry-unavailable` to revisit missing sources
or insufficient evidence, or `--force` to repeat all selected songs. The song-ID
environment variable also limits this runner to specific songs.

On Windows, running `scripts/run-audio-awake.py` with that Python runtime invokes
the same batch and holds off idle sleep only for the lifetime of the process.
Its arguments are forwarded to the Node runner. It does not change permanent
power settings. Job timeouts exclude long host-suspension gaps.

The importer accepts full-recording factors only after the duration checks and
prefers them over preview results, including for songs with existing AI ratings.
Pages explicitly label the source and recording duration. Full duration still
does not identify the lead voice or justify inventing unmeasured factors or an
overall rating. Failed matches and insufficient evidence remain visible in the
analysis report without creating new scores.

References: [Apple preview metadata](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/UnderstandingSearchResults.html),
[pYIN](https://librosa.org/doc/0.11.0/generated/librosa.pyin.html),
[foreground separation example and limitations](https://librosa.org/doc/0.11.0/auto_examples/plot_vocal_separation.html).

## Complete automated estimates

The user authorized nine-factor automated estimates with confidence and limitations.
Run the YouTube batch with `--complete-estimates`; its separate checkpoint is
`artifacts/complete-audio-analysis.json`. Existing partial assessments and AI ratings
are retained. `scripts/analyze-streaming-catalog.mjs` searches the public Monochrome
client endpoints for recordings unavailable to the previous YouTube pass. Sources
must match the title, credited artists and reference duration. Reviewed spelling
and release-title aliases carry references in the two audio alias files. Explicit
reviewed YouTube links are in `data/audio-source-overrides.json`.

All complete scores are **low-confidence, unvalidated acoustic proxy estimates**.
They are not listening reviews or calibrated singing-difficulty judgments. Pace
uses pitch-event speed; range uses pitch span; jumps use connected pitch changes;
sustain uses pitch-event duration; breath uses detected phrase duration; rhythm
uses entrances relative to an estimated beat grid; runs use rapid directional
small-step clusters; stamina uses detected activity duration; changes use adjacent
30-second pitch distributions. Words, syllables, actual breaths and physiological
effort are not measured. Lead voice, backing voices and instruments can be confused.
The nine ease values use the existing weights to compute the overall in code.

Complete analysis uses pYIN probability >= 0.35, with >= 10 seconds and 3% coverage,
at least 20 events, five phrases, three supported 30-second blocks, 16 beats and
sufficient foreground energy. High-confidence pitch seconds (>= 0.75) are reported
separately. Pitch resolution is 0.25 semitones for the batch; earlier proof runs
used 0.1. These thresholds describe tracking evidence, not confidence in singing
difficulty. Missing evidence still produces an incomplete result.

Optional `--neural-vocals` uses the publisher's UVR-MDX-NET-Voc_FT ONNX vocal model
before pYIN. Its model metadata hash is verified; CPU inference is available through
the local ONNX runtime. It can improve tracking coverage but does not establish the
lead singer or validate the difficulty bands. Neural results have a separate report
and take precedence over foreground proxies during import.

Run `node scripts/run.mjs tsx scripts/import-complete-audio.ts` to strictly validate
and save supported results to `data/full-audio-estimates.json`. Both the API and
frontend expose all nine scores, reasons, measurements, source, coverage and
limitations. Qualified audience ratings retain precedence; complete audio estimates
then take precedence over AI knowledge ratings. Build and deploy both applications
to publish the current checkpoint. No audio result is written to audience votes.

For another pass over only incomplete songs, invoke the awake wrapper with
`--workflow --remaining`. This expands Monochrome analysis to every remaining
catalog song, then tries neural separation on duration-validated incomplete
recordings and retries YouTube sources that never supplied neural audio. Two
streaming jobs share a paced search queue and independent temporary files.
The workflow retains previously published complete estimates and verifies each
new deployment. YouTube metadata lookups are paced; lookup failures are recorded
as `source_lookup_failed`, rather than silently treated as a missing matching song.

The requested [FMHY audio index](https://fmhy.net/audio) lists the sources considered.
Monochrome's public search/playback interface worked. Octave requires membership,
so it was not used for unattended recording retrieval. No login challenge or
restricted access was bypassed. Temporary batch recordings are deleted after each
analysis; only measurements and source references are retained.
