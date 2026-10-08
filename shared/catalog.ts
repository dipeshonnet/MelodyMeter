import { songSearchText, searchTerms, type Song } from './rating';

export interface CatalogFilters {
  query: string;
  language: string;
  decade: string;
  ease: string;
  sort: string;
  favorites: ReadonlySet<string>;
}

/** Catalog data and derived indexes, independent of browser storage and the DOM. */
export class SongCatalog {
  private entries = new Map<string, { song: Song; text: string; score: number | null }>();
  private orders = new Map<string, Song[]>();

  add(song: Song): boolean {
    if (this.entries.has(song.id)) return false;
    this.entries.set(song.id, { song, text: songSearchText(song), score: song.ai?.overall ?? null });
    this.orders.clear();
    return true;
  }

  get(id: string): Song | undefined { return this.entries.get(id)?.song; }

  setScore(id: string, score: number | null): void {
    const entry = this.entries.get(id);
    if (!entry || entry.score === score) return;
    entry.score = score;
    this.orders.delete('easy');
    this.orders.delete('hard');
  }

  private ordered(sort: string): Song[] {
    const cached = this.orders.get(sort);
    if (cached) return cached;
    const entries = [...this.entries.values()];
    if (sort === 'title') entries.sort((a, b) => a.song.title.localeCompare(b.song.title));
    else if (sort === 'easy') entries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    else if (sort === 'hard') entries.sort((a, b) => (a.score ?? 11) - (b.score ?? 11));
    const songs = entries.map(entry => entry.song);
    this.orders.set(sort, songs);
    return songs;
  }

  select(filters: CatalogFilters): { ordered: readonly Song[]; matches: Set<string> } {
    const terms = searchTerms(filters.query);
    const decade = filters.decade === 'all' ? null : Number(filters.decade);
    const matches = new Set<string>();
    for (const [id, { song, text, score }] of this.entries) {
      if (!terms.every(term => text.includes(term))) continue;
      if (filters.language === 'saved' ? !filters.favorites.has(id) : filters.language !== 'all' && song.language !== filters.language) continue;
      if (decade !== null && (!song.year || Math.floor(song.year / 10) * 10 !== decade)) continue;
      if (filters.ease !== 'all' && (score === null || !(filters.ease === 'easy' ? score >= 7 : filters.ease === 'medium' ? score >= 5 && score < 7 : score < 5))) continue;
      matches.add(id);
    }
    return { ordered: this.ordered(filters.sort), matches };
  }
}
