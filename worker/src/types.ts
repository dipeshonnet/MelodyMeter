export interface Env {
  DB: D1Database;
  AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
  APP_ORIGIN: string;
  EMAIL_HMAC_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_SECRET?: string;
  AI_MODEL?: string;
  AI_DAILY_BUDGET?: string;
  EMAIL_DAILY_LIMIT?: string;
  EMAIL_MONTHLY_LIMIT?: string;
  MAIL_FROM?: string;
  MUSICBRAINZ_CONTACT?: string;
  DEV_MODE?: string;
}
export interface SongRow {
  id: string; slug: string; title: string; artist: string; language: 'Hindi' | 'English' | 'Other';
  album: string; year: number | null; version: string; aliases_json: string;
  musicbrainz_id: string | null; reference_url: string | null; color: string;
}
export interface PendingRow { token_hash: string; email_key: string; song_id: string; scores_json: string; created_at: number; expires_at: number; consumed_at: number | null; }
export interface JobRow { song_id: string; status: string; attempts: number; next_attempt_at: number; lease_until: number; lease_token: string | null; message: string | null; refresh_requested: number; }
