import type { APIRoute } from 'astro';
import { songs } from '../lib/catalog';
import { collections } from '../lib/collections';
import { canonicalUrl, SCORE_GUIDE } from '../lib/seo';

export const GET: APIRoute = ({ site }) => {
  const link = (name: string, path: string, description: string) => `- [${name}](${canonicalUrl(path, site)}): ${description}`;
  const text = ['# MelodyMeter', '', '> Singing-difficulty guidance for Hindi and English songs. Higher scores mean easier singing in a comfortable key.', '',
    `${songs.length} catalog recordings. Each recording has a canonical HTML page with visible song facts, estimate provenance and limitations. No login or JavaScript is needed to read the saved estimates.`, '',
    '## Pages', '', link('Explore songs', '/', 'Full searchable catalog.'),
    ...collections.map(collection => link(collection.label, `/${collection.slug}/`, collection.description)),
    link('Rating method', '/how-we-rate/', 'Nine weighted factors, score direction, confidence and audience qualification.'),
    link('Privacy', '/privacy/', 'How verification and saved songs work.'), '',
    '## Public data', '', link('Catalog JSON', '/catalog.json', 'Build-time snapshot with canonical URLs, plain-text URLs, saved overall estimates and partial-factor coverage. No live audience votes or private data.'),
    link('Sitemap', '/sitemap.xml', 'Canonical public HTML pages.'), '',
    'Every catalog entry has a markdownUrl in the JSON catalog. Use that URL for a plain-text song summary, factor scores, sources and limitations.', '',
    '## Interpreting the scores', '', SCORE_GUIDE, '',
    'Complete audio estimates use unvalidated acoustic proxies, and all nine factors have low confidence. Pitch periodicity is not proof of lead-vocal identity or rating accuracy. AI knowledge estimates are provisional judgments and do not analyze audio.', '',
    'The catalog and Markdown are build-time snapshots. Live audience ratings are loaded separately on the canonical song page. Do not describe automated estimates as community votes, star reviews, measured human effort, or calibrated vocal advice. Cite the canonical song page and retain the confidence qualifier when quoting a score.', '',
    '## Optional', '', '- [Source repository](https://github.com/dipeshonnet/MelodyMeter): Application source and analysis documentation.', '',
  ].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
