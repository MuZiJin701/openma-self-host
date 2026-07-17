/** Additive schema for the Node self-host Skills Store. */
export const SELF_HOST_SKILLS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  latest_version TEXT,
  archived_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills (user_id, created_at, id);
CREATE TABLE IF NOT EXISTS skill_versions (
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, skill_id, version)
);
CREATE TABLE IF NOT EXISTS skill_blobs (
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  PRIMARY KEY (user_id, skill_id, version, filename)
);
`;
