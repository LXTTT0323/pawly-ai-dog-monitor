ALTER TABLE pets ADD COLUMN is_monitored INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pet_photos (
  id TEXT PRIMARY KEY NOT NULL,
  pet_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_email) REFERENCES users(email) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pet_photos_pet_id_idx ON pet_photos(pet_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pet_photos_owner_email_idx ON pet_photos(owner_email);
