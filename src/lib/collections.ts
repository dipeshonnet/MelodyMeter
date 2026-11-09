import type { Song } from '../../shared/rating';

export const collections = [
  { slug: 'easy-songs', title: 'Easy Songs to Sing in Hindi & English | MelodyMeter', heading: 'Easy songs to sing',
    description: 'Explore Hindi and English songs with saved singing-ease estimates of 7–10. Compare vocal factors and choose a comfortable key.',
    intro: 'These recordings have a saved audio or AI singing-ease estimate of at least 7/10. Audio estimates are low confidence, and AI knowledge estimates are provisional. Your chosen key and familiarity can change how easy a song feels.', label: 'Easy songs', filter: (song: Song) => (song.audioEstimate?.overall ?? song.ai?.overall ?? 0) >= 7 },
  { slug: 'hindi-songs', title: 'Hindi Songs by Singing Difficulty | MelodyMeter', heading: 'Hindi songs by singing difficulty',
    description: 'Find Hindi songs for singing practice. Compare ease scores, pitch-range factors, breathing room and rating evidence across the catalog.',
    intro: 'Explore Hindi recordings from the 1950s to the 2020s. Compare the main lead melody in a comfortable key. Higher scores mean easier singing; songs without enough evidence remain unscored.', label: 'Hindi songs', filter: (song: Song) => song.language === 'Hindi' },
  { slug: 'english-songs', title: 'English Songs by Singing Difficulty | MelodyMeter', heading: 'English songs by singing difficulty',
    description: 'Find English songs for singing practice. Compare ease scores, vocal factors and provisional rating evidence from familiar classics to recent songs.',
    intro: 'Explore English recordings from the 1950s to the 2020s. Check the vocal factors and evidence before choosing a song for practice or a sing-along. Higher scores mean easier singing in a comfortable key.', label: 'English songs', filter: (song: Song) => song.language === 'English' },
];

export function collectionSongs(collection: typeof collections[number], songs: Song[]): Song[] {
  return songs.filter(collection.filter).sort((a, b) => (b.audioEstimate?.overall ?? b.ai?.overall ?? -1) - (a.audioEstimate?.overall ?? a.ai?.overall ?? -1) || a.title.localeCompare(b.title));
}
