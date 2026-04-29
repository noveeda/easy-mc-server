-- Applies M2 alpha integrity hardening to databases that were created before
-- composite relationship constraints and hashed audit session identifiers existed.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS session_id_hash TEXT;
ALTER TABLE audit_events DROP COLUMN IF EXISTS session_id;

DELETE FROM presence p
WHERE NOT EXISTS (
  SELECT 1 FROM rooms r WHERE r.id = p.room_id AND r.host_id = p.host_id
);

DELETE FROM sessions s
WHERE NOT EXISTS (
  SELECT 1
  FROM approval_requests ar
  WHERE ar.id = s.request_id
    AND ar.room_id = s.room_id
    AND ar.invite_id = s.invite_id
);

DELETE FROM approval_requests ar
WHERE NOT EXISTS (
  SELECT 1 FROM invites i WHERE i.id = ar.invite_id AND i.room_id = ar.room_id
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_id_host_id_unique') THEN
    ALTER TABLE rooms ADD CONSTRAINT rooms_id_host_id_unique UNIQUE (id, host_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invites_id_room_id_unique') THEN
    ALTER TABLE invites ADD CONSTRAINT invites_id_room_id_unique UNIQUE (id, room_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_id_room_id_invite_id_unique') THEN
    ALTER TABLE approval_requests
      ADD CONSTRAINT approval_requests_id_room_id_invite_id_unique UNIQUE (id, room_id, invite_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_invite_room_fk') THEN
    ALTER TABLE approval_requests
      ADD CONSTRAINT approval_requests_invite_room_fk
      FOREIGN KEY (invite_id, room_id) REFERENCES invites(id, room_id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_request_room_invite_fk') THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_request_room_invite_fk
      FOREIGN KEY (request_id, room_id, invite_id)
      REFERENCES approval_requests(id, room_id, invite_id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presence_room_host_fk') THEN
    ALTER TABLE presence
      ADD CONSTRAINT presence_room_host_fk
      FOREIGN KEY (room_id, host_id) REFERENCES rooms(id, host_id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE approval_requests VALIDATE CONSTRAINT approval_requests_invite_room_fk;
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_request_room_invite_fk;
ALTER TABLE presence VALIDATE CONSTRAINT presence_room_host_fk;

CREATE INDEX IF NOT EXISTS idx_audit_events_session_id_hash_occurred_at
  ON audit_events(session_id_hash, occurred_at)
  WHERE session_id_hash IS NOT NULL;
