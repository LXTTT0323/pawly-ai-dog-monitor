export const pawlyProfileSchema = {
  users: {
    primaryKey: "email",
    columns: ["email", "display_name", "created_at", "updated_at"],
  },
  pets: {
    primaryKey: "id",
    columns: ["id", "owner_email", "name", "species", "is_primary", "is_monitored", "created_at", "updated_at"],
  },
  petPhotos: {
    primaryKey: "id",
    columns: ["id", "pet_id", "owner_email", "object_key", "content_type", "size_bytes", "created_at"],
  },
  devicePreferences: {
    primaryKey: "device_id",
    columns: ["device_id", "location_name", "pet_id", "preferred_facing", "updated_at"],
  },
  petTargets: {
    primaryKey: "device_id",
    columns: ["device_id", "pet_id", "box_json", "scene_version", "updated_at"],
  },
} as const;
