export const schemaSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY, facebook_id text UNIQUE NOT NULL, name text NOT NULL,
  token_enc text NOT NULL, permissions jsonb NOT NULL DEFAULT '[]',
  token_expires_at timestamptz, data_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY, owner_id uuid UNIQUE NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, name text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  csrf_token text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash text PRIMARY KEY, browser_hash text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  facebook_id text NOT NULL, name text NOT NULL, category text NOT NULL DEFAULT '',
  tasks jsonb NOT NULL DEFAULT '[]', token_enc text NOT NULL,
  status text NOT NULL CHECK(status IN ('connected','expired','disconnected')),
  can_post boolean NOT NULL DEFAULT false, can_comment boolean NOT NULL DEFAULT false,
  token_expires_at timestamptz, last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, facebook_id), UNIQUE(id, workspace_id)
);
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL, text text NOT NULL, media jsonb, first_comment text NOT NULL DEFAULT '',
  page_ids uuid[] NOT NULL, scheduled_at timestamptz, status text NOT NULL DEFAULT 'draft',
  idempotency_key text NOT NULL, body_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,idempotency_key), UNIQUE(id,workspace_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL, page_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('publish','comment')),
  status text NOT NULL CHECK(status IN ('queued','running','retrying','succeeded','failed','uncertain','canceled')),
  phase text NOT NULL DEFAULT 'publish' CHECK(phase IN ('publish','video_wait','comment')),
  scheduled_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz, retry_safe boolean NOT NULL DEFAULT false,
  facebook_post_id text, facebook_comment_id text, video_id text, video_checks integer NOT NULL DEFAULT 0,
  last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id,workspace_id) REFERENCES campaigns(id,workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (page_id,workspace_id) REFERENCES pages(id,workspace_id) ON DELETE CASCADE,
  UNIQUE(campaign_id,page_id,kind)
);
CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status,scheduled_at);
CREATE INDEX IF NOT EXISTS jobs_workspace ON jobs(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_page_status ON jobs(page_id,status);
CREATE TABLE IF NOT EXISTS page_lanes (facebook_id text PRIMARY KEY, next_allowed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action text NOT NULL, detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deletion_receipts (
  code uuid PRIMARY KEY, status text NOT NULL CHECK(status IN ('completed')), created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id uuid PRIMARY KEY,
  concurrency integer NOT NULL CHECK(concurrency BETWEEN 1 AND 16),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_heartbeats_last_seen ON worker_heartbeats(last_seen);
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
`;
