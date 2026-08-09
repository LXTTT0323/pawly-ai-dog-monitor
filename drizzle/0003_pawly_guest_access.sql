CREATE TABLE IF NOT EXISTS guest_invites (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_by_email TEXT,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS guest_invites_room_active_idx ON guest_invites(room_id, expires_at, revoked_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS guest_access (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  guest_invite_id TEXT NOT NULL,
  guest_identity TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (guest_invite_id) REFERENCES guest_invites(id) ON DELETE CASCADE,
  UNIQUE(room_id, guest_identity)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS guest_access_room_active_idx ON guest_access(room_id, expires_at, revoked_at);
