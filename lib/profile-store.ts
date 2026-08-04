export type PetSpecies = "dog" | "cat";

export interface PetProfile {
  id: string;
  ownerEmail: string;
  name: string;
  species: PetSpecies;
  isPrimary: boolean;
  createdAt: number;
  updatedAt: number;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

interface D1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

const memory = globalThis as typeof globalThis & {
  pawlyProfileMemory?: {
    users: Map<string, { displayName: string; createdAt: number; updatedAt: number }>;
    pets: Map<string, PetProfile>;
    targets: Map<string, { box: { x: number; y: number; width: number; height: number }; updatedAt: number }>;
  };
};
memory.pawlyProfileMemory ??= { users: new Map(), pets: new Map(), targets: new Map() };
memory.pawlyProfileMemory.targets ??= new Map();

let databasePromise: Promise<D1Database | null> | null = null;

async function getDatabase(): Promise<D1Database | null> {
  if (!databasePromise) {
    databasePromise = (async () => {
      try {
        const moduleName = "cloudflare:workers";
        const cloudflare = await import(/* @vite-ignore */ moduleName) as { env?: { DB?: D1Database } };
        const database = cloudflare.env?.DB ?? null;
        if (!database && process.env.NODE_ENV === "production") throw new Error("Pawly profile database is unavailable");
        return database;
      } catch {
        if (process.env.NODE_ENV === "production") throw new Error("Pawly profile database is unavailable");
        return null;
      }
    })();
  }
  return databasePromise;
}

export async function upsertUser(email: string, displayName: string) {
  const now = Date.now();
  const db = await getDatabase();
  if (!db) {
    const current = memory.pawlyProfileMemory!.users.get(email);
    memory.pawlyProfileMemory!.users.set(email, {
      displayName,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
    return;
  }
  await db.prepare(`
    INSERT INTO users (email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
  `).bind(email, displayName, now, now).run();
}

export async function listPets(ownerEmail: string): Promise<PetProfile[]> {
  const db = await getDatabase();
  if (!db) {
    return [...memory.pawlyProfileMemory!.pets.values()]
      .filter((pet) => pet.ownerEmail === ownerEmail)
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.createdAt - right.createdAt);
  }
  const rows = await db.prepare(`
    SELECT id, owner_email, name, species, is_primary, created_at, updated_at
    FROM pets WHERE owner_email = ? ORDER BY is_primary DESC, created_at ASC
  `).bind(ownerEmail).all<Record<string, unknown>>();
  return (rows.results ?? []).map(mapPet);
}

export async function createPet(ownerEmail: string, name: string, species: PetSpecies): Promise<PetProfile> {
  const now = Date.now();
  const existing = await listPets(ownerEmail);
  const pet: PetProfile = {
    id: crypto.randomUUID(),
    ownerEmail,
    name: name.trim().slice(0, 40) || "My pet",
    species,
    isPrimary: existing.length === 0,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDatabase();
  if (!db) memory.pawlyProfileMemory!.pets.set(pet.id, pet);
  else await db.prepare(`
    INSERT INTO pets (id, owner_email, name, species, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(pet.id, ownerEmail, pet.name, pet.species, pet.isPrimary ? 1 : 0, now, now).run();
  return pet;
}

export async function updatePet(ownerEmail: string, petId: string, input: { name: string; species: PetSpecies; isPrimary?: boolean }) {
  const current = (await listPets(ownerEmail)).find((pet) => pet.id === petId);
  if (!current) return null;
  const now = Date.now();
  const next = { ...current, name: input.name.trim().slice(0, 40) || current.name, species: input.species, isPrimary: input.isPrimary ?? current.isPrimary, updatedAt: now };
  const db = await getDatabase();
  if (!db) {
    if (next.isPrimary) {
      for (const pet of memory.pawlyProfileMemory!.pets.values()) if (pet.ownerEmail === ownerEmail) pet.isPrimary = false;
    }
    memory.pawlyProfileMemory!.pets.set(next.id, next);
  } else {
    const statements: D1Statement[] = [];
    if (next.isPrimary) statements.push(db.prepare("UPDATE pets SET is_primary = 0, updated_at = ? WHERE owner_email = ?").bind(now, ownerEmail));
    statements.push(db.prepare("UPDATE pets SET name = ?, species = ?, is_primary = ?, updated_at = ? WHERE id = ? AND owner_email = ?")
      .bind(next.name, next.species, next.isPrimary ? 1 : 0, now, petId, ownerEmail));
    await db.batch(statements);
  }
  return next;
}

export async function getPetTarget(deviceId: string) {
  const db = await getDatabase();
  if (!db) return memory.pawlyProfileMemory!.targets.get(deviceId) ?? null;
  const row = await db.prepare("SELECT box_json, updated_at FROM pet_targets WHERE device_id = ?").bind(deviceId).first<{ box_json: string; updated_at: number }>();
  if (!row) return null;
  try {
    const box = JSON.parse(row.box_json) as { x: number; y: number; width: number; height: number };
    return { box, updatedAt: Number(row.updated_at) };
  } catch {
    return null;
  }
}

export async function savePetTarget(deviceId: string, box: { x: number; y: number; width: number; height: number } | null) {
  const db = await getDatabase();
  if (!db) {
    if (box) memory.pawlyProfileMemory!.targets.set(deviceId, { box, updatedAt: Date.now() });
    else memory.pawlyProfileMemory!.targets.delete(deviceId);
    return;
  }
  if (!box) {
    await db.prepare("DELETE FROM pet_targets WHERE device_id = ?").bind(deviceId).run();
    return;
  }
  const now = Date.now();
  await db.prepare(`
    INSERT INTO pet_targets (device_id, pet_id, box_json, scene_version, updated_at)
    VALUES (?, NULL, ?, NULL, ?)
    ON CONFLICT(device_id) DO UPDATE SET box_json = excluded.box_json, updated_at = excluded.updated_at
  `).bind(deviceId, JSON.stringify(box), now).run();
}

function mapPet(row: Record<string, unknown>): PetProfile {
  return {
    id: String(row.id),
    ownerEmail: String(row.owner_email),
    name: String(row.name),
    species: row.species === "cat" ? "cat" : "dog",
    isPrimary: Number(row.is_primary) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
