# Ease calibration, revision 3

The previous hosted catalog collapsed around 5/10. Its small-model prompt included repeated numeric profiles and example reasons. Live comparison revealed copied factor patterns and reversed ease judgments.

The model now classifies each factor independently as very easy, easy, moderate, hard, or very hard. Application code maps those labels to integer ease scores 9, 8, 6, 4, and 2. The existing nine weights and rounded overall calculation are unchanged. This deliberately uses broad estimate bands rather than implying precise audio measurements. Audience ratings still accept every integer 1–10 and remain independent of AI estimates.

Calibration judges a casual, recognizable main melody in a comfortable key. Matching the original singer's tone, power, optional ornaments, or backing harmonies is not required. Transposition does not shrink the melody's pitch span. Instrumental pace is not singing speed. Repetition, natural breath breaks, and absent essential runs can earn high ease scores. Challenging lead range, leaps, phrasing, or changing sections can earn low ease scores.

Before changing saved assessments, a quota-limited administrator-only preview compared real Workers AI output on three recordings: Stand by Me 9/10, Bohemian Rhapsody 3/10, Tum Hi Ho 7/10. These are subjective estimates, not expert measurements. The raw preview artifact is saved locally in artifacts/calibration-preview.json. Further song-specific evaluation and audience comparison remain useful.

Explicit recalibration queues an assessment while retaining the old score. A successful replacement archives the previous AI assessment and commits the new one in the same D1 batch. Invalid output and quota failures preserve the previous rating. No audience votes or aggregates are edited. Ordinary on-demand jobs cannot overwrite saved assessments. Scores embedded in newer published pages supersede older local snapshots without discarding cached audience data.

Twelve additional recording identities were reviewed in MusicBrainz, split equally between Hindi and English. The shortlist used [SingWell's voice-teacher guide](https://singwell.eu/easy-songs-to-sing/) and [Riyaz's beginner Hindi selection](https://riyazapp.com/blog/top-10-easy-to-sing-hindi-songs-for-beginners/) as discovery leads, plus familiar sing-alongs. Those sources do not supply our numeric scores. Recording selection and model inference determine which entries actually qualify for the easy filter. MusicBrainz supplies identity metadata, not vocal difficulty evidence.

The catalog has a prominent Show easy songs shortcut and a shareable `/?ease=easy` view, sorted by highest primary score. Language filters still work with the easy selection. Qualifying community scores continue to take precedence over AI estimates.
