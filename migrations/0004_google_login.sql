CREATE TABLE google_login_nonces (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX google_login_nonces_expiry ON google_login_nonces(expires_at);
