import { starterSongs } from '../../data/starter';
import launchCatalog from '../../data/launch-catalog.json';
import type { Song } from '../../shared/rating';
import { partialAudioFor, fullAudioFor } from '../../shared/audio-assessments';

export const songs: Song[] = launchCatalog.length ? [] : [...starterSongs];
for (const song of launchCatalog as Song[]) {
  const index = songs.findIndex(s => s.id === song.id || (s.title.toLowerCase() === song.title.toLowerCase() && s.artist.toLowerCase() === song.artist.toLowerCase()));
  if (index >= 0) songs[index] = song;
  else songs.push(song);
}
for (const song of songs) { song.audio = partialAudioFor(song.id); song.audioEstimate = fullAudioFor(song.id); }
export const decades = [...new Set(songs.filter(song => song.year).map(song => Math.floor(song.year! / 10) * 10))].sort((a, b) => a - b);
export const catalogStats = { total: songs.length, hindi: songs.filter(s => s.language === 'Hindi').length, english: songs.filter(s => s.language === 'English').length, rated: songs.filter(s => s.ai).length, launchTarget: 1000 };
