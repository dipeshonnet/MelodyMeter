import { readFileSync, writeFileSync } from 'node:fs';

// Explicitly reviewed studio recordings, rather than the first search result.
const selections = [
  ['7311ccc9-0868-46fd-abf1-ef6e20912784', 'Mangal Rang', 'Hindi', 'Ramayana', 4, ['मंगल रंग']],
  ['99ea0f03-9c4b-448b-8c4f-335468526f6d', 'iloveitiloveitiloveit', 'English', 'iloveitiloveitiloveit', 7, []],
  ['c42ed6fe-a005-4d93-983d-5718e4134a96', 'Tu Mil Jaaye', 'Hindi', 'KING', 5, ['तू मिल जाए']],
  ['dc971aed-66be-4ba8-9f21-31511227fca4', 'Homewrecker', 'English', 'Homewrecker', 14, []],
  ['414eba2c-422d-4063-a19a-125bac7cf501', 'Hriday Mein Jinke Sitaram', 'Hindi', 'Hanuman Ansh', 7, ['हृदय में जिनके सीताराम']],
  ['781018b7-f4f0-4fae-9b41-f45ecbe34024', 'I Just Might', 'English', 'The Romantic', 18, []],
  ['bec58d9d-ca25-40ca-921b-c9d4d51ab565', 'Jaiye Sajana', 'Hindi', 'Dhurandhar: The Revenge', 9, ['जाइए सजना']],
  ['3e6e9956-f059-411f-b661-5c2eefcebc02', 'Fever Dream', 'English', 'WILDCHILD', 21, []],
  ['5dab6f23-6ea9-42b9-b09f-cba30f47243f', 'Judi Jodi', 'Hindi', 'Ramayana', 23, ['जुड़ी जोड़ी', 'Judi Jodi - HINDI']],
  ['2c85fe70-3c0e-4b43-8d97-f5b5c4757f3a', 'American Girls', 'English', 'Kiss All the Time. Disco, Occasionally.', 23, []],
];
const sources = [
  { language: 'Hindi', label: 'Hindi Top 100 · 11 November 2026', url: 'https://www.boxofficeindia24.com/music/charts/hindi' },
  { language: 'English', label: 'Official Charts · biggest songs of 2026 through Q3', url: 'https://www.officialcharts.com/chart-news/official-biggest-songs-of-2026/' },
];
const catalog = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const entries = [];
for (const [mbid, title, language, album, chartPosition, aliases] of selections) {
  const response = await fetch(`https://musicbrainz.org/ws/2/recording/${mbid}?inc=artist-credits+releases&fmt=json`, {
    headers: { 'User-Agent': 'MelodyMeter/1.0 (https://melody.everydayai.work)' }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`MusicBrainz ${response.status}: ${title}`);
  const recording = await response.json();
  if (!recording['first-release-date']?.startsWith('2026')) throw new Error(`Unverified 2026 release: ${title}`);
  if (/live|remix|instrumental|orchestral|demo/i.test(`${recording.title} ${recording.disambiguation || ''}`)) throw new Error(`Review version: ${title}`);
  const artist = recording['artist-credit'].map(credit => credit.name + (credit.joinphrase || '')).join('');
  const id = `mb:${mbid}`;
  const song = { id, slug: `recording-${mbid}`, title, artist, language, album, year: 2026,
    version: 'Original studio lead melody', aliases: [...new Set([...aliases, recording.title, album])],
    musicbrainzId: mbid, referenceUrl: `https://musicbrainz.org/recording/${mbid}`, color: language === 'Hindi' ? 'amber' : 'teal' };
  // Never replace existing metadata, ratings, votes or recording identities.
  if (!catalog.some(existing => existing.id === id)) catalog.push(song);
  entries.push({ songId: id, title, language, chartPosition, sourceUrl: sources.find(source => source.language === language).url,
    musicbrainzTitle: recording.title, musicbrainzFirstRelease: recording['first-release-date'], referenceUrl: song.referenceUrl });
  console.log(`Verified ${language}: ${title} — ${artist}`);
  await new Promise(resolve => setTimeout(resolve, 1300));
}
// Commit files only after all ten recording checks succeed.
writeFileSync('data/launch-catalog.json', JSON.stringify(catalog, null, 2) + '\n');
writeFileSync('data/top-2026.json', JSON.stringify({ checkedOn: '2026-11-11',
  selection: 'Editorial selection of five Hindi and five English chart hits released in 2026 with verified studio recording identities. Hindi uses a daily chart; English uses UK year-to-date data through Q3. This is not a combined global ranking or a final year-end chart.',
  sources, entries }, null, 2) + '\n');
