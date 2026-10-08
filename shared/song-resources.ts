import catalogResources from '../data/song-resources.json';
import type { Song } from './rating';

export interface PracticeLink { url: string; provider: string; }
export interface SongResources {
  songId: string;
  lyrics: PracticeLink & { format: 'text' | 'lyric_video' };
  original: PracticeLink & { format: 'audio' | 'video' };
  karaoke: PracticeLink;
  video?: PracticeLink & { label?: string };
}
const byRecording = new Map((catalogResources as SongResources[]).map(resource => [resource.songId, resource]));

export function practiceLinks(songId: string, song?: Pick<Song, 'title' | 'artist' | 'album'>) {
  const resources = byRecording.get(songId);
  if (!resources) {
    if (!song) return [];
    const query = [song.title, song.artist, song.album].filter(Boolean).join(' ');
    return [
      { url: `https://www.google.com/search?q=${encodeURIComponent(query + ' lyrics')}`, provider: 'Google search · link not yet curated', title: 'Lyrics', action: 'Find lyrics', icon: 'Aa' },
      { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' official song')}`, provider: 'YouTube search · link not yet curated', title: 'Song audio & video', action: 'Find original song', icon: '▶' },
      { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' karaoke')}`, provider: 'YouTube search · link not yet curated', title: 'Karaoke', action: 'Find sing-along track', icon: '♫' },
    ];
  }
  return [
    { ...resources.lyrics, title: 'Lyrics', action: resources.lyrics.format === 'lyric_video' ? 'Open lyric video' : 'Read lyrics', icon: 'Aa' },
    { ...resources.original, title: resources.original.format === 'video' ? 'Song audio & video' : 'Song audio', action: resources.original.format === 'video' ? 'Listen / watch' : 'Listen to the song', icon: '▶' },
    { ...resources.karaoke, title: 'Karaoke', action: 'Sing along', icon: '♫' },
    ...(resources.video ? [{ ...resources.video, title: resources.video.label || 'Song video', action: 'Watch video', icon: '▶' }] : []),
  ];
}
