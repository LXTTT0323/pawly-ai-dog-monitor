CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL CHECK (species IN ('dog', 'cat')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (owner_email) REFERENCES users(email) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pets_owner_email_idx ON pets(owner_email);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS device_preferences (
  device_id TEXT PRIMARY KEY NOT NULL,
  location_name TEXT NOT NULL DEFAULT 'Pet room',
  pet_id TEXT,
  preferred_facing TEXT NOT NULL DEFAULT 'environment',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pet_targets (
  device_id TEXT PRIMARY KEY NOT NULL,
  pet_id TEXT,
  box_json TEXT NOT NULL,
  scene_version TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (pet_id) REFERENCES pets(id) ON DELETE SET NULL
);
