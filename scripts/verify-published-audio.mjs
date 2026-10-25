import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert';
const entries = JSON.parse(readFileSync('data/audio-assessments.json', 'utf8'));
const fullEntries = JSON.parse(readFileSync('data/full-audio-estimates.json', 'utf8'));
const targets = [...entries.map(entry => ({ ...entry, field: 'audio' })), ...fullEntries.map(entry => ({ ...entry, field: 'audioEstimate' }))];
let next = 0, checked = 0;
const failures = [];
async function verify() {
  while (next < targets.length) {
    const entry = targets[next++];
    try {
      const response = await fetch(`https://melody.everydayai.work/api/ratings/${encodeURIComponent(entry.songId)}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rating = await response.json();
      deepStrictEqual(rating.song[entry.field], entry.assessment);
      if (entry.field === 'audio' && 'overall' in rating.song.audio) throw new Error('Partial audio assessment must not manufacture an overall.');
      checked++;
    } catch (error) { failures.push({ songId: entry.songId, error: String(error).slice(0, 200) }); }
  }
}
await Promise.all([verify(), verify(), verify()]);
console.log(JSON.stringify({ expected: targets.length, partial: entries.length, complete: fullEntries.length, checked, failures }, null, 2));
if (failures.length) process.exitCode = 1;
