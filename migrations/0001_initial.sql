-- MelodyMeter v1. Aggregates are rebuilt by triggers inside each vote transaction.
PRAGMA foreign_keys = ON;
CREATE TABLE songs (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, artist TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('Hindi','English','Other')), album TEXT NOT NULL DEFAULT '',
  year INTEGER, version TEXT NOT NULL, aliases_json TEXT NOT NULL DEFAULT '[]',
  musicbrainz_id TEXT UNIQUE, reference_url TEXT, color TEXT NOT NULL DEFAULT 'teal',
  search_text TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX songs_search ON songs(language, title);
CREATE TABLE ai_ratings (song_id TEXT PRIMARY KEY REFERENCES songs(id), payload TEXT NOT NULL, model TEXT NOT NULL, rubric_version TEXT NOT NULL, generated_at INTEGER NOT NULL);
CREATE TABLE votes (
  song_id TEXT NOT NULL REFERENCES songs(id), email_key TEXT NOT NULL,
  overall INTEGER NOT NULL CHECK(overall BETWEEN 1 AND 10),
  pace INTEGER CHECK(pace IS NULL OR pace BETWEEN 1 AND 10),
  range INTEGER CHECK(range IS NULL OR range BETWEEN 1 AND 10),
  jumps INTEGER CHECK(jumps IS NULL OR jumps BETWEEN 1 AND 10),
  sustain INTEGER CHECK(sustain IS NULL OR sustain BETWEEN 1 AND 10),
  breath INTEGER CHECK(breath IS NULL OR breath BETWEEN 1 AND 10),
  rhythm INTEGER CHECK(rhythm IS NULL OR rhythm BETWEEN 1 AND 10),
  runs INTEGER CHECK(runs IS NULL OR runs BETWEEN 1 AND 10),
  stamina INTEGER CHECK(stamina IS NULL OR stamina BETWEEN 1 AND 10),
  changes INTEGER CHECK(changes IS NULL OR changes BETWEEN 1 AND 10),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at INTEGER NOT NULL, PRIMARY KEY(song_id,email_key)
);
CREATE INDEX votes_active ON votes(song_id,active);
CREATE TABLE audience_aggregates (song_id TEXT PRIMARY KEY REFERENCES songs(id), payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TRIGGER votes_insert AFTER INSERT ON votes BEGIN INSERT INTO audience_aggregates(song_id, payload, updated_at) VALUES (NEW.song_id, (SELECT json_object('count', COUNT(*), 'overall', AVG(overall), 'factors', json_object('pace', json_object('count', COUNT(pace), 'score', AVG(pace)), 'range', json_object('count', COUNT(range), 'score', AVG(range)), 'jumps', json_object('count', COUNT(jumps), 'score', AVG(jumps)), 'sustain', json_object('count', COUNT(sustain), 'score', AVG(sustain)), 'breath', json_object('count', COUNT(breath), 'score', AVG(breath)), 'rhythm', json_object('count', COUNT(rhythm), 'score', AVG(rhythm)), 'runs', json_object('count', COUNT(runs), 'score', AVG(runs)), 'stamina', json_object('count', COUNT(stamina), 'score', AVG(stamina)), 'changes', json_object('count', COUNT(changes), 'score', AVG(changes)))) FROM votes WHERE song_id = NEW.song_id AND active = 1), unixepoch()) ON CONFLICT(song_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at; END;
CREATE TRIGGER votes_update AFTER UPDATE ON votes BEGIN INSERT INTO audience_aggregates(song_id, payload, updated_at) VALUES (NEW.song_id, (SELECT json_object('count', COUNT(*), 'overall', AVG(overall), 'factors', json_object('pace', json_object('count', COUNT(pace), 'score', AVG(pace)), 'range', json_object('count', COUNT(range), 'score', AVG(range)), 'jumps', json_object('count', COUNT(jumps), 'score', AVG(jumps)), 'sustain', json_object('count', COUNT(sustain), 'score', AVG(sustain)), 'breath', json_object('count', COUNT(breath), 'score', AVG(breath)), 'rhythm', json_object('count', COUNT(rhythm), 'score', AVG(rhythm)), 'runs', json_object('count', COUNT(runs), 'score', AVG(runs)), 'stamina', json_object('count', COUNT(stamina), 'score', AVG(stamina)), 'changes', json_object('count', COUNT(changes), 'score', AVG(changes)))) FROM votes WHERE song_id = NEW.song_id AND active = 1), unixepoch()) ON CONFLICT(song_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at; END;
CREATE TRIGGER votes_delete AFTER DELETE ON votes BEGIN INSERT INTO audience_aggregates(song_id, payload, updated_at) VALUES (OLD.song_id, (SELECT json_object('count', COUNT(*), 'overall', AVG(overall), 'factors', json_object('pace', json_object('count', COUNT(pace), 'score', AVG(pace)), 'range', json_object('count', COUNT(range), 'score', AVG(range)), 'jumps', json_object('count', COUNT(jumps), 'score', AVG(jumps)), 'sustain', json_object('count', COUNT(sustain), 'score', AVG(sustain)), 'breath', json_object('count', COUNT(breath), 'score', AVG(breath)), 'rhythm', json_object('count', COUNT(rhythm), 'score', AVG(rhythm)), 'runs', json_object('count', COUNT(runs), 'score', AVG(runs)), 'stamina', json_object('count', COUNT(stamina), 'score', AVG(stamina)), 'changes', json_object('count', COUNT(changes), 'score', AVG(changes)))) FROM votes WHERE song_id = OLD.song_id AND active = 1), unixepoch()) ON CONFLICT(song_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at; END;
CREATE TABLE pending_verifications (
  token_hash TEXT PRIMARY KEY, email_key TEXT NOT NULL, song_id TEXT NOT NULL REFERENCES songs(id),
  scores_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX pending_expiry ON pending_verifications(expires_at);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, email_key TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE generation_jobs (
  song_id TEXT PRIMARY KEY REFERENCES songs(id), status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT, message TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_ready ON generation_jobs(status,next_attempt_at);
CREATE TABLE budget_reservations (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, identity_key TEXT, ip_key TEXT,
  amount INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX budget_kind_time ON budget_reservations(kind,created_at);
CREATE INDEX budget_identity_time ON budget_reservations(kind,identity_key,created_at);
CREATE TABLE source_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE locks (name TEXT PRIMARY KEY, available_at INTEGER NOT NULL);
CREATE TABLE feedback (id TEXT PRIMARY KEY, song_id TEXT REFERENCES songs(id), message TEXT NOT NULL, created_at INTEGER NOT NULL);
-- Local-only mailbox. No raw recipient email is stored here.
CREATE TABLE dev_mail (id TEXT PRIMARY KEY, song_id TEXT NOT NULL, verification_url TEXT NOT NULL, created_at INTEGER NOT NULL);
