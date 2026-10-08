CREATE TABLE IF NOT EXISTS ai_assessment_history (
  song_id TEXT NOT NULL REFERENCES songs(id),
  payload TEXT NOT NULL,
  model TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  archived_at INTEGER NOT NULL,
  correction_reason TEXT NOT NULL,
  PRIMARY KEY(song_id, generated_at)
);
