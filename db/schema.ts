export const pawlyProfileSchema = {
  users: {
    primaryKey: "email",
    columns: ["email", "display_name", "created_at", "updated_at"],
  },
  pets: {
    primaryKey: "id",
    columns: ["id", "owner_email", "name", "species", "is_primary", "created_at", "updated_at"],
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
