import type { APIRoute } from 'astro';
import { canonicalUrl } from '../lib/seo';

export const GET: APIRoute = ({ site }) => new Response([
  '# Public pages are available to search engines and AI search crawlers.',
  '# Utility pages use noindex; private API routes retain their access controls.',
  'User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /dev-mail/', '',
  `Sitemap: ${canonicalUrl('/sitemap.xml', site)}`, '',
].join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
