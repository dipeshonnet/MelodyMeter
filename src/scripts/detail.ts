import { FACTORS, emptyAudience, primaryScore, overallLabel, easeLabel, type Song, type VoteInput, type RatingResponse } from '../../shared/rating';
import { api, ClientError, readStorage, writeStorage, toast, updateFavorites } from './common';
import { challenge, resetChallenge } from './challenges';
import { practiceLinks } from '../../shared/song-resources';
import { showGoogleButton } from './google';
const root = document.querySelector<HTMLElement>('#song-detail')!;
let song: Song | null = JSON.parse(document.querySelector('#song-data')?.textContent || 'null');
let songId = song?.id || new URL(location.href).searchParams.get('id') || '';
let verified = false, useOtherEmail = false, polling = false;
let googleEnabled = false;
const form = document.querySelector<HTMLFormElement>('#vote-form')!;
const email = document.querySelector<HTMLInputElement>('#vote-email')!;
const submit = document.querySelector<HTMLButtonElement>('#submit-vote')!;
const status = document.querySelector<HTMLElement>('#vote-status')!;
const pendingPanel = document.querySelector<HTMLElement>('#generation-panel')!;
function errorMessage(error: unknown): string { return error instanceof ClientError ? error.message + (error.retryAt ? ` Retry after ${new Date(error.retryAt).toLocaleString()}.` : '') : error instanceof Error ? error.message : 'Please try again.'; }
function showStatus(message: string, failure = false) { status.textContent = message; status.hidden = false; status.classList.toggle('error', failure); }
function draftKey() { return `mm:draft:${songId}`; }
function readVote(): VoteInput | null {
  const overall = new FormData(form).get('overall'); if (!overall) return null;
  const factors = Object.fromEntries(FACTORS.map(f => [f.id, (form.elements.namedItem(f.id) as HTMLSelectElement).value]).filter(([, value]) => value !== '').map(([id, value]) => [id, Number(value)]));
  return { overall: Number(overall), factors };
}
function fillVote(vote: VoteInput) {
  const radio = form.querySelector<HTMLInputElement>(`input[name="overall"][value="${vote.overall}"]`); if (radio) radio.checked = true;
  FACTORS.forEach(f => { (form.elements.namedItem(f.id) as HTMLSelectElement).value = vote.factors[f.id] ? String(vote.factors[f.id]) : ''; });
}
function applySession() {
  const active = verified && !useOtherEmail;
  document.querySelector<HTMLElement>('#verified-session')!.hidden = !active;
  document.querySelector<HTMLElement>('#email-field')!.hidden = active;
  email.required = !active;
  document.querySelector<HTMLElement>('#google-login')!.hidden = active || !googleEnabled;
  submit.textContent = active ? 'Submit rating' : 'Verify & submit rating';
}
function render(value: RatingResponse, cached = false) {
  song = value.song; songId = song.id; root.dataset.songId = songId;
  const links = practiceLinks(songId, song);
  const practicePanel = document.querySelector<HTMLElement>('#practice-panel')!;
  const practiceContainer = document.querySelector<HTMLElement>('#practice-links')!;
  practicePanel.hidden = !links.length;
  practiceContainer.replaceChildren(...links.map(link => {
    const anchor = document.createElement('a'); anchor.className = 'practice-link';
    anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
    anchor.setAttribute('aria-label', `${link.title}: ${link.action} on ${link.provider} (opens in a new tab)`);
    const icon = document.createElement('span'); icon.className = 'practice-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = link.icon;
    const title = document.createElement('strong'); title.textContent = link.title;
    const action = document.createElement('span'); action.textContent = `${link.action} ↗`;
    const provider = document.createElement('small'); provider.textContent = link.provider;
    anchor.append(icon, title, action, provider); return anchor;
  }));
  const { score, source } = primaryScore(value.ai, value.audience);
  document.querySelectorAll('[data-song-title]').forEach(el => { el.textContent = song!.title; });
  document.querySelector('[data-song-artist]')!.textContent = song.artist;
  document.querySelector('[data-language]')!.textContent = song.language;
  document.querySelector('[data-year]')!.textContent = String(song.year || 'Selected recording');
  document.querySelector('[data-version]')!.textContent = song.version;
  document.querySelector('[data-initials]')!.textContent = song.title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.querySelector<HTMLButtonElement>('[data-save]')!.dataset.save = songId;
  updateFavorites();
  const scoreElement = document.querySelector<HTMLElement>('#primary-score')!;
  scoreElement.querySelector('strong')!.textContent = score === null ? '—' : source === 'community' ? score.toFixed(1) : String(score);
  scoreElement.dataset.tier = score === null ? 'pending' : score >= 7 ? 'easy' : score >= 5 ? 'medium' : 'hard';
  document.querySelector('#primary-label')!.textContent = score === null ? 'Estimate not available yet' : overallLabel(score);
  document.querySelector('#primary-source')!.textContent = source === 'community' ? `Community rated · ${value.audience.overall.count} verified ratings` : value.ai ? 'AI estimate · 10 is easiest' : 'Request an estimate below';
  const secondary = document.querySelector<HTMLElement>('#ai-secondary')!; secondary.hidden = source !== 'community' || !value.ai; secondary.textContent = value.ai ? `AI estimate: ${value.ai.overall}/10` : '';
  document.querySelector('#community-count')!.textContent = value.audience.overall.qualified ? `${value.audience.overall.count} verified audience ratings` : `${value.audience.overall.count} of 10 audience ratings received`;
  document.querySelector<HTMLElement>('#community-progress')!.style.width = `${Math.min(100, value.audience.overall.count * 10)}%`;
  document.querySelector('#assessment')!.textContent = value.ai?.explanation || 'An AI estimate will appear here when enough information is available. You can still share your own singing experience.';
  document.querySelector<HTMLElement>('#tip-panel')!.hidden = !value.ai;
  document.querySelector('#singing-tip')!.textContent = value.ai?.tip || '';
  FACTORS.forEach(f => {
    const row = document.querySelector<HTMLElement>(`[data-factor="${f.id}"]`)!;
    const ai = value.ai?.factors[f.id]; const community = value.audience.factors[f.id];
    row.querySelector('[data-factor-reason]')!.textContent = value.ai?.reasons[f.id] || f.description;
    row.querySelector('[data-factor-ai]')!.innerHTML = `${ai ?? '—'}<small>${ai ? easeLabel(ai) : 'Pending'}</small>`;
    row.querySelector('[data-factor-community]')!.innerHTML = community.qualified && community.score !== null ? `<b>${community.score.toFixed(1)}/10</b>${community.count} ratings` : `${community.count} of 10<br>ratings`;
  });
  document.querySelector('#rating-date')!.textContent = `${cached ? 'Saved snapshot · ' : ''}${value.ai ? `${value.ai.model === 'authoring-ai-provisional' ? 'Provisional AI judgment' : 'AI estimate'} updated ${new Date(value.ai.generatedAt).toLocaleDateString()}` : 'Main lead melody in a comfortable key'}${cached ? ' · Community counts may have changed since this was saved.' : ''}`;
  pendingPanel.hidden = !!value.ai;
  const generation = document.querySelector<HTMLButtonElement>('#request-estimate')!;
  const job = value.job;
  document.querySelector('#generation-copy')!.textContent = job?.message || (job ? 'Your estimate is waiting to be generated. It will be saved for everyone.' : 'Request an AI estimate for this recording.');
  generation.hidden = !!job; generation.disabled = !navigator.onLine;
  document.title = `${song.title} — singing difficulty | MelodyMeter`;
  if (!cached) { writeStorage(`mm:rating:${songId}`, value); const summaries = readStorage<Record<string, RatingResponse['audience']>>('mm:summaries:v1', {}); summaries[songId] = value.audience; writeStorage('mm:summaries:v1', summaries); }
  if (job && ['queued', 'processing'].includes(job.status) && !polling) { polling = true; window.setTimeout(() => { polling = false; if (navigator.onLine && !document.hidden) refresh(); }, 15000); }
}
async function refresh() {
  if (!songId) return;
  try { render(await api<RatingResponse>(`/api/ratings/${encodeURIComponent(songId)}`)); }
  catch (error) {
    if (error instanceof ClientError && error.code === 'song_not_found' && songId.startsWith('mb:')) {
      try { const resolved = await api<{ song: Song }>(`/api/recordings/${encodeURIComponent(songId)}`); render({ song: resolved.song, ai: null, audience: emptyAudience() }); return; }
      catch (lookupError) { showStatus(errorMessage(lookupError), true); }
    } else if (!song) showStatus(errorMessage(error), true);
  }
}
form.addEventListener('change', () => { const vote = readVote(); if (vote) writeStorage(draftKey(), vote); });
form.addEventListener('submit', async event => {
  event.preventDefault(); const vote = readVote(); if (!vote || !songId) return;
  writeStorage(draftKey(), vote); submit.disabled = true;
  try {
    const token = await challenge('vote-challenge');
    const response = await api<{ status: string; rating?: RatingResponse; localMailbox?: boolean }>('/api/audience', { method: 'POST', body: JSON.stringify({ songId, rating: vote, email: verified && !useOtherEmail ? undefined : email.value, turnstileToken: token }) });
    if (response.status === 'counted') { if (response.rating) render(response.rating); try { localStorage.removeItem(draftKey()); } catch {} showStatus('Your rating has been counted. An update replaces your previous vote.'); }
    else { showStatus(response.localMailbox ? 'Local test: your confirmation link is in the test inbox. No email was sent.' : 'Check your inbox. Open the link, review your scores, and confirm to count your rating.'); document.querySelector<HTMLElement>('#open-local-inbox')!.hidden = !response.localMailbox; }
  } catch (error) { showStatus(errorMessage(error), true); }
  finally { submit.disabled = false; resetChallenge('vote-challenge'); }
});
document.querySelector('#change-email')!.addEventListener('click', () => { useOtherEmail = true; applySession(); email.focus(); });
document.querySelector<HTMLButtonElement>('#show-google-login')!.addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  const container = document.querySelector<HTMLElement>('#google-login-button')!;
  const failed = (error: unknown) => { showStatus(errorMessage(error), true); button.hidden = false; button.disabled = false; };
  try {
    await showGoogleButton(container, () => {
      verified = true; useOtherEmail = false; email.value = ''; submit.disabled = false; applySession();
      showStatus('Signed in with Google. Press Submit rating when you’re ready.');
    }, failed);
    button.hidden = true;
  } catch (error) { failed(error); }
  finally { button.disabled = false; }
});
document.querySelector('#share-song')!.addEventListener('click', async () => {
  try { if (navigator.share) await navigator.share({ title: `${song?.title || 'Song'} — MelodyMeter`, url: location.href }); else { await navigator.clipboard.writeText(location.href); toast('Song link copied'); } } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) toast('Copy the song URL from your address bar to share it.'); }
});
document.querySelector<HTMLButtonElement>('#request-estimate')!.addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  try { const token = await challenge('generation-challenge'); render(await api<RatingResponse>('/api/ratings', { method: 'POST', body: JSON.stringify({ songId, turnstileToken: token }) })); }
  catch (error) { document.querySelector('#generation-copy')!.textContent = errorMessage(error); }
  finally { button.disabled = false; resetChallenge('generation-challenge'); }
});
const dialog = document.querySelector<HTMLDialogElement>('#feedback-dialog')!;
document.querySelector('#report-rating')!.addEventListener('click', () => dialog.showModal());
document.querySelector('#close-feedback')!.addEventListener('click', () => dialog.close());
document.querySelector<HTMLFormElement>('#feedback-form')!.addEventListener('submit', async event => {
  event.preventDefault(); const target = document.querySelector<HTMLElement>('#feedback-status')!; target.hidden = false;
  const button = (event.currentTarget as HTMLFormElement).querySelector<HTMLButtonElement>('[type=submit]')!; button.disabled = true;
  try { const token = await challenge('feedback-challenge'); await api('/api/feedback', { method: 'POST', body: JSON.stringify({ songId, message: document.querySelector<HTMLTextAreaElement>('#feedback-message')!.value, turnstileToken: token }) }); target.textContent = 'Thank you. Your feedback has been received.'; toast('Rating problem reported'); }
  catch (error) { target.textContent = errorMessage(error); }
  finally { button.disabled = false; resetChallenge('feedback-challenge'); }
});
async function initialize() {
  if (!songId) { showStatus('Choose a recording from the catalog first.', true); submit.disabled = true; return; }
  if (!song) { try { song = JSON.parse(sessionStorage.getItem(`mm:found:${songId}`) || 'null'); } catch {} }
  const cached = readStorage<RatingResponse | null>(`mm:rating:${songId}`, null);
  if (cached && song?.ai && (!cached.ai || song.ai.generatedAt > cached.ai.generatedAt)) {
    cached.ai = song.ai; cached.song = song;
    writeStorage(`mm:rating:${songId}`, cached);
  }
  if (cached) render(cached, true); else if (song) render({ song, ai: song.ai || null, audience: emptyAudience() }, true);
  const draft = readStorage<VoteInput | null>(draftKey(), null); if (draft) fillVote(draft);
  await refresh();
  try { const session = await api<{ verified: boolean }>('/api/session'); verified = session.verified; applySession(); if (verified && !draft) { const previous = await api<{ rating: VoteInput | null }>(`/api/my-vote/${encodeURIComponent(songId)}`); if (previous.rating) { fillVote(previous.rating); submit.textContent = 'Update my rating'; } } } catch {}
  try { googleEnabled = (await api<{ enabled: boolean }>('/api/auth/google/config')).enabled; applySession(); } catch {}
  try {
    const health = await api<{ verificationConfigured: boolean }>('/api/health');
    if (!health.verificationConfigured && !verified) {
      submit.disabled = true;
      submit.textContent = 'Email verification coming soon';
      showStatus(googleEnabled ? 'Use Google to verify your rating. Email verification is not available yet.' : 'Audience submissions will open when verification is ready. You can choose scores now; your draft stays on this device.');
    }
  } catch {}
}
window.addEventListener('online', refresh);
initialize();
