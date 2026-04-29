CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  alias TEXT,
  minecraft_version TEXT,
  pack_profile_name TEXT,
  state TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  UNIQUE (id, host_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  revoked_at BIGINT,
  UNIQUE (id, room_id)
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  invite_id TEXT NOT NULL,
  friend_id TEXT,
  minecraft_uuid TEXT NOT NULL,
  display_name TEXT,
  state TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  decided_at BIGINT,
  UNIQUE (id, room_id, invite_id),
  FOREIGN KEY (invite_id, room_id) REFERENCES invites(id, room_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  invite_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  minecraft_uuid TEXT NOT NULL,
  session_credential_hash TEXT,
  state TEXT NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT,
  FOREIGN KEY (request_id, room_id, invite_id) REFERENCES approval_requests(id, room_id, invite_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presence (
  room_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  state TEXT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  FOREIGN KEY (room_id, host_id) REFERENCES rooms(id, host_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  signal_hash TEXT NOT NULL,
  count INTEGER NOT NULL,
  limit_value INTEGER NOT NULL,
  window_ms INTEGER NOT NULL,
  reset_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (scope, signal_hash)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_id TEXT,
  room_id TEXT,
  invite_id TEXT,
  request_id TEXT,
  session_id_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invites_room_id ON invites(room_id);
CREATE INDEX IF NOT EXISTS idx_invites_expires_at_ttl ON invites(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approval_requests_room_id_state ON approval_requests(room_id, state);
CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at_ttl ON sessions(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_presence_expires_at_ttl ON presence(expires_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_reset_at_ttl ON rate_limit_counters(reset_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_room_id_occurred_at ON audit_events(room_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_type_occurred_at ON audit_events(type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_session_id_hash_occurred_at ON audit_events(session_id_hash, occurred_at)
  WHERE session_id_hash IS NOT NULL;
