import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FACTOR_IDS, fullAudioSchema, overallScore, primaryScore, emptyAudience, type Song } from '../shared/rating';
import { SongCatalog } from '../shared/catalog';
const factors = Object.fromEntries(FACTOR_IDS.map(id => [id, 8])) as any;
const fixture = { factors, overall: overallScore(factors), reasons: Object.fromEntries(FACTOR_IDS.map(id => [id, 'An acoustic proxy with unverified lead vocals.'])),
  confidence: Object.fromEntries(FACTOR_IDS.map(id => [id, 'low'])), method: 'mdx-pyin-nine-proxies-v1', scope: 'full_recording',
  generatedAt: '2026-10-11T00:00:00.000Z', clipSeconds: 240, confidentPitchSeconds: 100,
  trackingPitchSeconds: 150, trackingProbabilityThreshold: .35,
  pitchResolutionSemitones: .25,
  sourceUrl: 'https://monochrome.st/track/158313604994150400', sourceTitle: 'Matched song', sourceArtist: 'Matched artist',
  measurements: Object.fromEntries(FACTOR_IDS.map(id => [id, 1])), limitations: ['Difficulty bands are not calibrated.', 'Lead vocals have not been verified.', 'Words and actual breaths were not measured.'] };
test('complete audio ratings require nine factors, measured proxies, low confidence, and a weighted overall', () => {
  const audio = fullAudioSchema.parse(fixture);
  assert.equal(audio.overall, 8);
  assert.throws(() => fullAudioSchema.parse({ ...fixture, overall: 9 }));
  assert.throws(() => fullAudioSchema.parse({ ...fixture, factors: { range: 8 } }));
  assert.throws(() => fullAudioSchema.parse({ ...fixture, measurements: { range: 1 } }));
  assert.throws(() => fullAudioSchema.parse({ ...fixture, confidence: { ...fixture.confidence, runs: 'high' } }));
  assert.throws(() => fullAudioSchema.parse({ ...fixture, trackingPitchSeconds: 3 }));
  assert.throws(() => fullAudioSchema.parse({ ...fixture, sourceUrl: 'https://example.com/track/123' }));
});
test('complete audio estimates appear in overall filtering and preserve community precedence', () => {
  const audio = fullAudioSchema.parse(fixture);
  assert.deepEqual(primaryScore(null, emptyAudience(), audio), { score: 8, source: 'audio' });
  const community = emptyAudience(); community.overall = { count: 10, qualified: true, score: 7.2 };
  assert.deepEqual(primaryScore(null, community, audio), { score: 7.2, source: 'community' });
  const catalog = new SongCatalog();
  catalog.add({ id: 'test', title: 'Matched song', artist: 'Matched artist', slug: 'test', language: 'English', album: '', version: '', aliases: [], color: 'teal', audioEstimate: audio } as Song);
  const result = catalog.select({ query: '', language: 'all', decade: 'all', ease: 'easy', sort: 'easy', favorites: new Set() });
  assert.equal(result.matches.has('test'), true);
});
