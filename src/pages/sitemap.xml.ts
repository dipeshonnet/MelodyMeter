import type { APIRoute } from 'astro';
import { songs } from '../lib/catalog';
import { collections } from '../lib/collections';
import { canonicalUrl } from '../lib/seo';

export const GET: APIRoute = ({ site }) => {
  const paths = ['/', '/how-we-rate/', '/privacy/', ...collections.map(collection => `/${collection.slug}/`), ...songs.map(song => `/songs/${song.slug}/`)];
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(path => `  <url><loc>${escape(canonicalUrl(path, site))}</loc></url>`).join('\n')}\n</urlset>\n`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
