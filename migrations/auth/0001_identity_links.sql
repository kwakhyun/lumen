CREATE TABLE auth_identity_links (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  owner_id TEXT NOT NULL UNIQUE,
  verified_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
