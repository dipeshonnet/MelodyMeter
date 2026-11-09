import type { APIRoute, GetStaticPaths } from 'astro';
import { songs } from '../../lib/catalog';
import { songMarkdown } from '../../lib/seo';
import type { Song } from '../../../shared/rating';

export const getStaticPaths: GetStaticPaths = () => songs.map(song => ({ params: { slug: song.slug }, props: { song } }));
export const GET: APIRoute = ({ props, site }) => new Response(songMarkdown(props.song as Song, site), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
