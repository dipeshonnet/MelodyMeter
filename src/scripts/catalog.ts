import { overallLabel, type Song, type RatingResponse, type AudienceRating } from '../../shared/rating';
import { SongCatalog } from '../../shared/catalog';
import { api, escapeHTML, readStorage, savedSongs, cachedSavedSongs, toast, writeStorage, updateFavorites } from './common';

const source = document.querySelector('#catalog-data');
const songs: Song[] = JSON.parse(source?.textContent || '[]');
const catalog = new SongCatalog();
for (const song of songs) catalog.add(song);
const params = new URL(location.href).searchParams;
const input = document.querySelector<HTMLInputElement>('#song-search')!;
const ease = document.querySelector<HTMLSelectElement>('#ease-filter')!;
const decade = document.querySelector<HTMLSelectElement>('#decade-filter')!;
const requestedDecade = params.get('decade');
if (requestedDecade && Array.from(decade.options).some(option => option.value === requestedDecade)) decade.value = requestedDecade;
const sort = document.querySelector<HTMLSelectElement>('#song-sort')!;
const requestedEase = params.get('ease');
if (requestedEase && ['easy', 'medium', 'hard'].includes(requestedEase)) {
  ease.value = requestedEase;
  sort.value = requestedEase === 'hard' ? 'hard' : 'easy';
}
const grid = document.querySelector<HTMLElement>('#song-grid')!;
const cards = Array.from(grid.querySelectorAll<HTMLElement>('.song-card'));
const cardsById = new Map(cards.map(card => [card.dataset.songId!, card]));
const resultsCount = document.querySelector('#results-count')!;
const emptyState = document.querySelector<HTMLElement>('#empty-state')!;
const emptyTitle = document.querySelector('#empty-title')!;
const emptyCopy = document.querySelector('#empty-copy')!;
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.filter-tabs button'));
let renderedOrder = cards.map(card => card.dataset.songId!);
const requestedLanguage = params.get('language');
let language = params.get('saved') === '1' ? 'saved' : requestedLanguage && ['Hindi', 'English'].includes(requestedLanguage) ? requestedLanguage : 'all';
let summaries = readStorage<Record<string, AudienceRating>>('mm:summaries:v1', {});
const cachedAudience = new Map<string, AudienceRating | undefined>();
function audienceFor(id: string): AudienceRating | undefined {
  if (summaries[id]) return summaries[id];
  if (!cachedAudience.has(id)) cachedAudience.set(id, readStorage<RatingResponse | null>(`mm:rating:${id}`, null)?.audience);
  return cachedAudience.get(id);
}
function filter() {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ decade: decade.value, ease: ease.value, language: language === 'saved' ? 'all' : language, saved: language === 'saved' ? '1' : 'all' })) {
    if (value === 'all') url.searchParams.delete(key); else url.searchParams.set(key, value);
  }
  if (url.href !== location.href) history.replaceState(null, '', url);
  const { ordered, matches } = catalog.select({ query: input.value, language, decade: decade.value, ease: ease.value, sort: sort.value, favorites: new Set(savedSongs()) });
  for (const card of cards) {
    const hidden = !matches.has(card.dataset.songId!);
    if (card.hidden !== hidden) card.hidden = hidden;
  }
  if (ordered.length !== renderedOrder.length || ordered.some((song, index) => song.id !== renderedOrder[index])) {
    const fragment = document.createDocumentFragment();
    for (const song of ordered) fragment.append(cardsById.get(song.id)!);
    grid.append(fragment);
    renderedOrder = ordered.map(song => song.id);
  }
  resultsCount.textContent = `${matches.size} ${matches.size === 1 ? 'song' : 'songs'} ${language === 'saved' ? 'saved' : 'to explore'}`;
  emptyState.hidden = matches.size > 0;
  emptyTitle.textContent = language === 'saved' && !input.value ? 'Your next songs belong here' : 'No songs found';
  emptyCopy.textContent = language === 'saved' && !input.value ? 'Tap the bookmark on a song to save it for later.' : 'Try another spelling, artist, or film.';
  tabs.forEach(button => { const active = button.dataset.language === language; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
}
function hydrateScores(targets = cards) { for (const card of targets) {
  const song = catalog.get(card.dataset.songId!)!;
  const audience = audienceFor(song.id);
  catalog.setScore(song.id, audience?.overall.qualified ? audience.overall.score : song.ai?.overall ?? null);
  if (audience?.overall.qualified && audience.overall.score !== null) {
    const score = audience.overall.score;
    card.querySelector('.score-badge strong')!.textContent = score.toFixed(1);
    card.querySelector('[data-card-label]')!.textContent = overallLabel(score);
    card.querySelector('[data-card-source]')!.textContent = `Community · ${audience.overall.count} ratings`;
    const badge = card.querySelector('.score-badge')!; badge.className = `score-badge ${score >= 7 ? 'easy' : score >= 5 ? 'medium' : 'hard'}`;
  } else {
    card.querySelector('.score-badge strong')!.textContent = String(song.ai?.overall ?? '—');
    card.querySelector('[data-card-label]')!.textContent = song.ai ? overallLabel(song.ai.overall) : 'Not rated yet';
    card.querySelector('[data-card-source]')!.textContent = song.ai ? 'AI estimate' : 'Audience ratings welcome';
    const score = song.ai?.overall; card.querySelector('.score-badge')!.className = `score-badge ${score === undefined ? '' : score >= 7 ? 'easy' : score >= 5 ? 'medium' : 'hard'}`;
  }
} }
function addSongs(incoming: Song[], refresh = true) {
  const added: HTMLElement[] = [];
  const fragment = document.createDocumentFragment();
  for (const song of incoming) {
    if (!catalog.add(song)) continue;
    const card = document.createElement('article'); card.className = 'song-card'; card.dataset.songId = song.id;
    const score = song.ai?.overall;
    const href = `/song/?id=${encodeURIComponent(song.id)}`;
    card.innerHTML = `<div class="song-art art-teal" aria-hidden="true"><span>${escapeHTML(song.title.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase())}</span></div><div class="card-content"><div class="card-topline"><span class="language-label">${escapeHTML(song.language)}</span><button class="save-button" data-save="${escapeHTML(song.id)}" aria-label="Save ${escapeHTML(song.title)}" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 4h12v17l-6-4-6 4z"/></svg></button></div><a class="song-title-link" href="${href}"><h2>${escapeHTML(song.title)}</h2></a><p class="artist">${escapeHTML(song.artist)}</p><div class="card-score-row"><span class="score-badge ${score === undefined ? '' : score>=7?'easy':score>=5?'medium':'hard'}"><strong>${score ?? '—'}</strong><span>/10</span></span><div><strong data-card-label>${score === undefined?'Awaiting estimate':overallLabel(score)}</strong><span class="source-label" data-card-source>${score === undefined?'Audience ratings welcome':'AI estimate'}</span></div></div><div class="mini-factors"><span>Speed <b>${song.ai?.factors.pace ?? '—'}</b></span><span>Range <b>${song.ai?.factors.range ?? '—'}</b></span><span>Jumps <b>${song.ai?.factors.jumps ?? '—'}</b></span></div></div>`;
    cards.push(card); cardsById.set(song.id, card); added.push(card); fragment.append(card);
  }
  grid.append(fragment);
  hydrateScores(added);
  if (refresh) { updateFavorites(); filter(); }
}
// Saved recordings outside the initial static catalog remain available offline.
addSongs(cachedSavedSongs(), false);
const savedSnapshots: Song[] = [];
for (const id of savedSongs()) { const snapshot = readStorage<RatingResponse | null>(`mm:rating:${id}`, null); if (snapshot) savedSnapshots.push({ ...snapshot.song, ai: snapshot.ai || undefined }); }
addSongs(savedSnapshots, false);
updateFavorites();
let searchTimer: number;
input.addEventListener('input', () => { window.clearTimeout(searchTimer); const query = input.value.trim(); if (query.length < 2) return; searchTimer = window.setTimeout(() => { api<{ songs: Song[] }>(`/api/search?q=${encodeURIComponent(query)}`).then(result => addSongs(result.songs)).catch(() => {}); }, 350); });
api<{ ratings: { id: string; audience: AudienceRating }[] }>('/api/audience-summary').then(result => { summaries = Object.fromEntries(result.ratings.map(row => [row.id, row.audience])); writeStorage('mm:summaries:v1', summaries); hydrateScores(); filter(); }).catch(() => {});
hydrateScores();
input.addEventListener('input', filter); ease.addEventListener('change', filter); decade.addEventListener('change', filter); sort.addEventListener('change', filter);
tabs.forEach(button => button.addEventListener('click', () => { language = button.dataset.language!; filter(); }));
document.querySelector('#clear-filters')?.addEventListener('click', () => { input.value = ''; language = 'all'; ease.value = 'all'; decade.value = 'all'; filter(); });
document.querySelector('#browse-easy')?.addEventListener('click', event => {
  event.preventDefault(); input.value = ''; language = 'all'; decade.value = 'all'; ease.value = 'easy'; sort.value = 'easy';
  history.replaceState(null, '', '/?ease=easy'); filter();
});
document.addEventListener('favorites-changed', event => { addSongs((event as CustomEvent<{ songs?: Song[] }>).detail?.songs || []); });
window.addEventListener('storage', event => {
  if (event.key === null || event.key === 'mm:summaries:v1') summaries = readStorage('mm:summaries:v1', {});
  if (event.key === null || event.key === 'mm:summaries:v1' || event.key.startsWith('mm:rating:')) {
    cachedAudience.clear(); hydrateScores(); filter();
  }
});
document.querySelector<HTMLButtonElement>('#external-search')!.addEventListener('click', async event => {
  if (input.value.trim().length < 3) { input.focus(); toast('Enter a song or artist in the search box first.'); return; }
  const target = event.currentTarget as HTMLButtonElement; target.disabled = true;
  const output = document.querySelector<HTMLElement>('#external-results')!; output.hidden = false; output.textContent = 'Looking for recordings…';
  try {
    const result = await api<{ songs: Song[] }>(`/api/search?q=${encodeURIComponent(input.value.trim())}&external=1`);
    if (!result.songs.length) { output.textContent = 'No matching recordings found. Try the song title and artist together.'; return; }
    output.innerHTML = result.songs.map(song => `<div class="external-result"><div><strong>${escapeHTML(song.title)}</strong><p>${escapeHTML(song.artist)}${song.album ? ' · ' + escapeHTML(song.album) : ''}</p><p>${escapeHTML(song.version)}</p></div><a class="secondary-button" href="/song/?id=${encodeURIComponent(song.id)}">View recording</a></div>`).join('');
    result.songs.forEach(song => { try { sessionStorage.setItem(`mm:found:${song.id}`, JSON.stringify(song)); } catch {} });
  } catch (error) { output.textContent = error instanceof Error ? error.message : 'Song search is unavailable.'; }
  finally { target.disabled = false; }
});
filter();
