import { FACTORS, overallLabel, type Song } from '../../shared/rating';

export const SITE_URL = 'https://melody.everydayai.work';
export const SITE_TITLE = 'MelodyMeter — Easy Hindi & English Songs to Sing';
export const SITE_DESCRIPTION = 'Find Hindi and English songs that fit your voice. Compare singing difficulty, nine vocal factors, provisional estimates and verified audience feedback.';
export const SCORE_GUIDE = 'Scores run from 1 to 10; higher means easier to sing in a comfortable key. Qualified audience ratings take precedence over complete audio estimates, then AI knowledge estimates. Each audience score needs 10 verified ratings. Partial audio measurements have no overall score.';
export type SchemaNode = Record<string, unknown>;

export function canonicalUrl(path: string, site: URL | string = SITE_URL): string {
  const url = new URL(path, site);
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/') && !url.pathname.split('/').pop()?.includes('.')) url.pathname += '/';
  return url.href;
}

export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function songDescription(song: Song): string {
  const intro = `How easy is ${song.title} by ${song.artist} to sing?`;
  if (song.audioEstimate) return `${intro} Audio estimate: ${song.audioEstimate.overall}/10, low confidence. See nine factors, evidence and audience feedback.`;
  if (song.ai) return `${intro} Provisional AI estimate: ${song.ai.overall}/10. Compare nine singing factors and audience feedback.`;
  return `${intro} ${song.audio ? 'See partial audio measurements; an overall score is not available yet.' : 'Explore the recording and contribute a verified singing rating.'}`;
}

export function songSummary(song: Song): string {
  const recording = `${song.title} by ${song.artist} is ${song.language === 'English' ? 'an' : 'a'} ${song.language}-language recording${song.album ? ` from ${song.album}` : ''}.`;
  if (song.audioEstimate) return `${recording} Its saved audio estimate is ${song.audioEstimate.overall}/10 (${overallLabel(song.audioEstimate.overall).toLowerCase()}; higher is easier), based on nine low-confidence acoustic proxies. Lead vocals and difficulty bands have not been validated.`;
  if (song.ai) return `${recording} Its saved AI knowledge estimate is ${song.ai.overall}/10 (${overallLabel(song.ai.overall).toLowerCase()}; higher is easier). This provisional judgment does not analyze audio.`;
  return `${recording} ${song.audio ? 'Only partial audio factors are available, so there is no audio overall score.' : 'A complete singing-difficulty estimate is not available yet.'}`;
}

export function pageSchema(path: string, title: string, description: string, site: URL | string = SITE_URL, nodes: SchemaNode[] = [], pageType = 'WebPage', mainEntity?: string) {
  const home = canonicalUrl('/', site), url = canonicalUrl(path, site);
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', '@id': `${home}#website`, url: home, name: 'MelodyMeter', description: SITE_DESCRIPTION, inLanguage: 'en' },
    { '@type': pageType, '@id': `${url}#webpage`, url, name: title, description, inLanguage: 'en', isPartOf: { '@id': `${home}#website` }, ...(mainEntity ? { mainEntity: { '@id': mainEntity } } : {}) },
    ...nodes,
  ] };
}

export function songSchema(song: Song, site: URL | string = SITE_URL) {
  const path = `/songs/${song.slug}/`, url = canonicalUrl(path, site);
  const nodes: SchemaNode[] = [
    { '@type': 'MusicRecording', '@id': `${url}#recording`, url, name: song.title, creditText: song.artist,
      inLanguage: song.language === 'Hindi' ? 'hi' : song.language === 'English' ? 'en' : undefined,
      ...(song.album ? { inAlbum: { '@type': 'MusicAlbum', name: song.album } } : {}),
      ...(song.musicbrainzId ? { identifier: { '@type': 'PropertyValue', propertyID: 'MusicBrainz recording ID', value: song.musicbrainzId }, sameAs: `https://musicbrainz.org/recording/${song.musicbrainzId}` } : {}),
      description: songSummary(song), subjectOf: { '@id': `${url}#webpage` } },
    { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Explore songs', item: canonicalUrl('/', site) },
      { '@type': 'ListItem', position: 2, name: song.title, item: url },
    ] },
  ];
  // Automated singing estimates are not audience reviews or aggregate star ratings.
  return pageSchema(path, `${song.title} — singing difficulty | MelodyMeter`, songDescription(song), site, nodes, 'WebPage', `${url}#recording`);
}

export function collectionSchema(path: string, title: string, description: string, songs: Song[], site: URL | string = SITE_URL) {
  const listId = `${canonicalUrl(path, site)}#songs`;
  return pageSchema(path, title, description, site, [{ '@type': 'ItemList', '@id': listId, name: title, numberOfItems: songs.length,
    itemListElement: songs.map((song, index) => ({ '@type': 'ListItem', position: index + 1, name: `${song.title} — ${song.artist}`, url: canonicalUrl(`/songs/${song.slug}/`, site) })) }], 'CollectionPage', listId);
}

export function songMarkdown(song: Song, site: URL | string = SITE_URL): string {
  const clean = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>|])/g, '\\$1');
  const lines = [`# ${clean(song.title)} — singing difficulty`, '', `Canonical page: ${canonicalUrl(`/songs/${song.slug}/`, site)}`, '', songSummary(song), '',
    `- Artist credit: ${clean(song.artist)}`, `- Language: ${song.language}`, `- Recording version: ${clean(song.version)}`,
    ...(song.year ? [`- Catalog release year: ${song.year}`] : []), '', SCORE_GUIDE, '',
    'This is a build-time snapshot of saved estimates. Live audience ratings are not included. The canonical song page retrieves the latest audience ratings.', ''];
  const estimate = song.audioEstimate ?? song.ai;
  if (estimate) {
    lines.push(`## ${song.audioEstimate ? 'Complete audio estimate — low confidence' : 'Provisional AI knowledge estimate'}`, '', `Overall singing ease: ${estimate.overall}/10. Updated: ${estimate.generatedAt}.`, '');
    for (const factor of FACTORS) lines.push(`- ${factor.label}: ${estimate.factors[factor.id]}/10. ${clean(estimate.reasons[factor.id])}`);
    if (song.audioEstimate) {
      const audio = song.audioEstimate;
      lines.push('', `Analyzed duration: ${audio.clipSeconds} seconds. Tracked pitch: ${audio.trackingPitchSeconds} seconds. Confident pitch: ${audio.confidentPitchSeconds} seconds.`, `Source recording: ${audio.sourceUrl}`, '', 'Limitations:', ...audio.limitations.map(item => `- ${clean(item)}`));
    }
    if (song.ai) lines.push('', ...(song.audioEstimate ? ['## AI knowledge estimate', '', `Provisional overall: ${song.ai.overall}/10.`] : []), clean(song.ai.explanation), '', `Practice tip: ${clean(song.ai.tip)}`);
  } else lines.push('## Overall estimate pending', '', 'No overall score is available.');
  if (song.audio && !song.audioEstimate) {
    lines.push('', '## Partial audio measurements', '', 'These factors do not produce an overall score.');
    for (const factor of FACTORS) if (song.audio.factors[factor.id] !== undefined) lines.push(`- ${factor.label}: ${song.audio.factors[factor.id]}/10. ${clean(song.audio.reasons[factor.id] || '')}`);
    lines.push('', `Source recording: ${song.audio.sourceUrl}`, `Analyzed duration: ${song.audio.clipSeconds} seconds. Confident pitch: ${song.audio.confidentPitchSeconds} seconds.`);
  }
  return [...lines, '', `Rating method and limitations: ${canonicalUrl('/how-we-rate/', site)}`, ''].join('\n');
}
