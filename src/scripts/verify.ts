import { FACTORS, type Song, type VoteInput, type RatingResponse } from '../../shared/rating';
import { api, escapeHTML, writeStorage, syncSavedSongs } from './common';
const target = document.querySelector<HTMLElement>('#verification-preview')!;
const token = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', location.pathname);
async function load() {
  if (!token) { target.textContent = 'Open the complete verification link from your email or the local test inbox.'; return; }
  try {
    const preview = await api<{ song: Song; rating: VoteInput; expiresAt: string }>('/api/verifications/preview', { method: 'POST', body: JSON.stringify({ token }) });
    target.innerHTML = `<h2>${escapeHTML(preview.song.title)}</h2><p class="artist">${escapeHTML(preview.song.artist)}</p><div class="verification-values"><div><strong>Overall ease</strong><strong>${preview.rating.overall}/10</strong></div>${FACTORS.filter(f => preview.rating.factors[f.id]).map(f => `<div><span>${f.label}</span><span>${preview.rating.factors[f.id]}/10</span></div>`).join('')}</div><p class="verification-copy">Link expires ${escapeHTML(new Date(preview.expiresAt).toLocaleTimeString())}. Confirming replaces any previous rating from this email for this song.</p><button class="primary-button" id="confirm-rating" style="margin-top:18px">Confirm rating</button><div id="confirmation-status" class="form-status" role="status" hidden></div>`;
    target.querySelector<HTMLButtonElement>('#confirm-rating')!.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
      const message = target.querySelector<HTMLElement>('#confirmation-status')!; message.hidden = false;
      try {
        const response = await api<{ songId: string; rating: RatingResponse }>('/api/verifications/confirm', { method: 'POST', body: JSON.stringify({ token }) });
        writeStorage(`mm:rating:${response.songId}`, response.rating);
        void syncSavedSongs();
        try { localStorage.removeItem(`mm:draft:${response.songId}`); } catch {}
        message.textContent = 'Your rating has been counted. Your email is verified on this browser for 30 days.'; button.hidden = true;
        const link = document.createElement('a'); link.className = 'secondary-button'; link.textContent = 'Back to the song'; link.href = `/song/?id=${encodeURIComponent(response.songId)}`; link.style.marginTop = '16px'; target.append(link);
      } catch (error) { message.textContent = error instanceof Error ? error.message : 'Please try again.'; message.classList.add('error'); button.disabled = false; }
    });
  } catch (error) { target.textContent = error instanceof Error ? error.message : 'This verification link is unavailable.'; }
}
load();
