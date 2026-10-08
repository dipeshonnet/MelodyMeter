CREATE TABLE saved_songs (
  email_key TEXT NOT NULL,
  song_id TEXT NOT NULL REFERENCES songs(id),
  saved_at INTEGER NOT NULL,
  PRIMARY KEY(email_key, song_id)
);
