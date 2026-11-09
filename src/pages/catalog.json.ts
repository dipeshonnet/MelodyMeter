import type { APIRoute } from 'astro';
import { songs } from '../lib/catalog';
import { canonicalUrl, SCORE_GUIDE } from '../lib/seo';
import { FACTORS } from '../../shared/rating';

export const GET: APIRoute = ({ site }) => new Response(JSON.stringify({
  name: 'MelodyMeter public song catalog', version: 1, url: canonicalUrl('/', site), total: songs.length,
  description: 'Build-time snapshot of public recording metadata and saved estimates. Live audience votes are not included.',
  scoreGuide: SCORE_GUIDE, methodUrl: canonicalUrl('/how-we-rate/', site),
  factors: FACTORS.map(({ id, label, description, weight }) => ({ id, label, description, weightPercent: weight })),
  songs: songs.map(song => {
    const estimate = song.audioEstimate ?? song.ai;
    return { id: song.id, title: song.title, artist: song.artist, language: song.language, album: song.album, catalogReleaseYear: song.year, version: song.version,
      url: canonicalUrl(`/songs/${song.slug}/`, site), markdownUrl: canonicalUrl(`/songs/${song.slug}.md`, site),
      estimate: estimate ? { source: song.audioEstimate ? 'full_audio' : 'ai_knowledge', confidence: song.audioEstimate ? 'low' : 'provisional',
        overall: estimate.overall, factors: estimate.factors, updatedAt: estimate.generatedAt,
        ...(song.audioEstimate ? { sourceUrl: song.audioEstimate.sourceUrl, limitations: song.audioEstimate.limitations } : {}) } : null,
      partialAudio: song.audio && !song.audioEstimate ? { factors: song.audio.factors, scope: song.audio.scope || 'preview', sourceUrl: song.audio.sourceUrl, updatedAt: song.audio.generatedAt, hasOverall: false } : null,
    };
  }),
}, null, 2) + '\n', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
