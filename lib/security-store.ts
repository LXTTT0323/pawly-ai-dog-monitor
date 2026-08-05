import { createRoomCode } from "@/lib/domain";

export interface RoomRecord {
  id: string;
  code: string;
  ownerEmail: string;
  ownerName: string | null;
  e2eeKeyCiphertext: string;
  createdAt: number;
}

export interface DeviceRecord {
  id: string;
  roomId: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

interface PairingRecord {
  id: string;
  roomId: string;
  tokenHash: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface MemoryState {
  rooms: Map<string, RoomRecord>;
  devices: Map<string, DeviceRecord>;
  pairings: Map<string, PairingRecord>;
  rateLimits: Map<string, { windowStartedAt: number; count: number }>;
  logs: Array<{ roomId: string; actorType: string; actorId: string; action: string; createdAt: number }>;
}

const memory = globalThis as typeof globalThis & { pawlySecurityMemory?: MemoryState };
memory.pawlySecurityMemory ??= {
  rooms: new Map(),
  devices: new Map(),
  pairings: new Map(),
  rateLimits: new Map(),
  logs: [],
};

let databasePromise: Promise<D1Database | null> | null = null;

async function getDatabase(): Promise<D1Database | null> {
  if (!databasePromise) {
    databasePromise = (async () => {
      try {
        const moduleName = "cloudflare:workers";
        const cloudflare = await import(/* @vite-ignore */ moduleName) as { env?: { DB?: D1Database } };
        const database = cloudflare.env?.DB ?? null;
        if (!database && process.env.NODE_ENV === "production") throw new Error("Pawly security database is unavailable");
        return database;
      } catch {
        if (process.env.NODE_ENV === "production") throw new Error("Pawly security database is unavailable");
        return null;
      }
    })();
  }
  return databasePromise;
}

export async function getOwnedRoom(ownerEmail: string): Promise<RoomRecord | null> {
  const db = await getDatabase();
  if (!db) return [...memory.pawlySecurityMemory!.rooms.values()].find((room) => room.ownerEmail === ownerEmail) ?? null;
  const row = await db.prepare("SELECT id, code, owner_email, owner_name, e2ee_key_ciphertext, created_at FROM rooms WHERE owner_email = ? ORDER BY created_at LIMIT 1")
    .bind(ownerEmail).first<Record<string, unknown>>();
  return row ? mapRoom(row) : null;
}

export async function getRoomByCode(code: string): Promise<RoomRecord | null> {
  const db = await getDatabase();
  if (!db) return [...memory.pawlySecurityMemory!.rooms.values()].find((room) => room.code === code) ?? null;
  const row = await db.prepare("SELECT id, code, owner_email, owner_name, e2ee_key_ciphertext, created_at FROM rooms WHERE code = ?")
    .bind(code).first<Record<string, unknown>>();
  return row ? mapRoom(row) : null;
}

export async function createOwnedRoom(ownerEmail: string, ownerName: string): Promise<RoomRecord> {
  const existing = await getOwnedRoom(ownerEmail);
  if (existing) return existing;
  let code = createRoomCode();
  while (await getRoomByCode(code)) code = createRoomCode();
  const room: RoomRecord = {
    id: crypto.randomUUID(),
    code,
    ownerEmail,
    ownerName,
    e2eeKeyCiphertext: await encryptRoomKey(randomSecret()),
    createdAt: Date.now(),
  };
  const db = await getDatabase();
  if (!db) memory.pawlySecurityMemory!.rooms.set(room.id, room);
  else await db.prepare("INSERT INTO rooms (id, code, owner_email, owner_name, e2ee_key_ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(room.id, room.code, room.ownerEmail, room.ownerName, room.e2eeKeyCiphertext, room.createdAt).run();
  await logAccess(room.id, "owner", ownerEmail, "room_created");
  return room;
}

export async function createPairingToken(room: RoomRecord) {
  const rawToken = randomSecret();
  const now = Date.now();
  const record: PairingRecord = {
    id: crypto.randomUUID(),
    roomId: room.id,
    tokenHash: await hashToken(rawToken),
    expiresAt: now + 15 * 60 * 1000,
    usedAt: null,
    createdAt: now,
  };
  const db = await getDatabase();
  if (!db) {
    for (const [id, pairing] of memory.pawlySecurityMemory!.pairings.entries()) {
      if (pairing.roomId === room.id && (pairing.usedAt !== null || pairing.expiresAt <= now)) {
        memory.pawlySecurityMemory!.pairings.delete(id);
      }
    }
    memory.pawlySecurityMemory!.pairings.set(record.id, record);
  } else {
    await db.prepare("INSERT INTO pairing_tokens (id, room_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)")
      .bind(record.id, room.id, record.tokenHash, record.expiresAt, record.createdAt).run();
  }
  await logAccess(room.id, "owner", room.ownerEmail, "pairing_created");
  return { token: rawToken, expiresAt: record.expiresAt };
}

export async function pairDevice(rawToken: string, name: string): Promise<{ room: RoomRecord; device: DeviceRecord; deviceToken: string } | null> {
  const tokenHash = await hashToken(rawToken);
  const now = Date.now();
  const db = await getDatabase();
  let pairing: PairingRecord | null;
  if (!db) {
    pairing = [...memory.pawlySecurityMemory!.pairings.values()]
      .find((item) => item.tokenHash === tokenHash && item.usedAt === null && item.expiresAt > now) ?? null;
    if (pairing) pairing.usedAt = now;
  } else {
    const row = await db.prepare("SELECT id, room_id, token_hash, expires_at, used_at, created_at FROM pairing_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
      .bind(tokenHash, now).first<Record<string, unknown>>();
    pairing = row ? mapPairing(row) : null;
    if (pairing) {
      const result = await db.prepare("UPDATE pairing_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(now, pairing.id).run();
      if (!result.meta?.changes) pairing = null;
    }
  }
  if (!pairing) return null;
  const room = await getRoomById(pairing.roomId);
  if (!room) return null;
  const deviceToken = randomSecret();
  const device: DeviceRecord = {
    id: crypto.randomUUID(),
    roomId: room.id,
    name: name.slice(0, 60) || "Camera device",
    tokenHash: await hashToken(deviceToken),
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
  if (!db) memory.pawlySecurityMemory!.devices.set(device.id, device);
  else await db.prepare("INSERT INTO devices (id, room_id, name, token_hash, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)")
    .bind(device.id, device.roomId, device.name, device.tokenHash, device.createdAt, device.lastSeenAt).run();
  await logAccess(room.id, "camera", device.id, "device_paired");
  return { room, device, deviceToken };
}

export async function verifyDevice(rawToken: string, roomCode: string): Promise<{ room: RoomRecord; device: DeviceRecord } | null> {
  const tokenHash = await hashToken(rawToken);
  const room = await getRoomByCode(roomCode);
  if (!room) return null;
  const db = await getDatabase();
  let device: DeviceRecord | null;
  if (!db) {
    device = [...memory.pawlySecurityMemory!.devices.values()]
      .find((item) => item.roomId === room.id && item.tokenHash === tokenHash && item.revokedAt === null) ?? null;
    if (device) device.lastSeenAt = Date.now();
  } else {
    const row = await db.prepare("SELECT id, room_id, name, token_hash, created_at, last_seen_at, revoked_at FROM devices WHERE room_id = ? AND token_hash = ? AND revoked_at IS NULL")
      .bind(room.id, tokenHash).first<Record<string, unknown>>();
    device = row ? mapDevice(row) : null;
    if (device) await db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(Date.now(), device.id).run();
  }
  return device ? { room, device } : null;
}

export async function listDevices(roomId: string): Promise<DeviceRecord[]> {
  const db = await getDatabase();
  if (!db) return [...memory.pawlySecurityMemory!.devices.values()].filter((device) => device.roomId === roomId && device.revokedAt === null);
  const result = await db.prepare("SELECT id, room_id, name, token_hash, created_at, last_seen_at, revoked_at FROM devices WHERE room_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
    .bind(roomId).all<Record<string, unknown>>();
  return (result.results ?? []).map(mapDevice);
}

export async function getOwnedDevice(ownerEmail: string, deviceId: string): Promise<DeviceRecord | null> {
  const db = await getDatabase();
  if (!db) {
    const device = memory.pawlySecurityMemory!.devices.get(deviceId);
    if (!device || device.revokedAt) return null;
    const room = memory.pawlySecurityMemory!.rooms.get(device.roomId);
    return room?.ownerEmail === ownerEmail ? device : null;
  }
  const row = await db.prepare(`
    SELECT devices.id, devices.room_id, devices.name, devices.token_hash, devices.created_at, devices.last_seen_at, devices.revoked_at
    FROM devices INNER JOIN rooms ON rooms.id = devices.room_id
    WHERE devices.id = ? AND devices.revoked_at IS NULL AND rooms.owner_email = ?
  `).bind(deviceId, ownerEmail).first<Record<string, unknown>>();
  return row ? mapDevice(row) : null;
}

export async function revokeDevice(roomId: string, deviceId: string): Promise<DeviceRecord | null> {
  const db = await getDatabase();
  if (!db) {
    const device = memory.pawlySecurityMemory!.devices.get(deviceId);
    if (!device || device.roomId !== roomId || device.revokedAt) return null;
    device.revokedAt = Date.now();
    return device;
  }
  const row = await db.prepare("SELECT id, room_id, name, token_hash, created_at, last_seen_at, revoked_at FROM devices WHERE id = ? AND room_id = ? AND revoked_at IS NULL")
    .bind(deviceId, roomId).first<Record<string, unknown>>();
  if (!row) return null;
  await db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").bind(Date.now(), deviceId).run();
  return mapDevice(row);
}

export async function decryptRoomKey(room: RoomRecord) {
  const [ivEncoded, ciphertextEncoded] = room.e2eeKeyCiphertext.split(".");
  if (!ivEncoded || !ciphertextEncoded) throw new Error("Invalid encrypted room key");
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(ivEncoded, "base64url") },
    key,
    Buffer.from(ciphertextEncoded, "base64url"),
  );
  return Buffer.from(plaintext).toString("utf8");
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const db = await getDatabase();
  if (!db) {
    const current = memory.pawlySecurityMemory!.rateLimits.get(key);
    const next = !current || current.windowStartedAt <= now - windowMs
      ? { windowStartedAt: now, count: 1 }
      : { ...current, count: current.count + 1 };
    memory.pawlySecurityMemory!.rateLimits.set(key, next);
    return next.count <= limit;
  }
  const resetBefore = now - windowMs;
  const row = await db.prepare(`
    INSERT INTO rate_limits (key, window_started_at, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      window_started_at = CASE WHEN window_started_at <= ? THEN ? ELSE window_started_at END,
      count = CASE WHEN window_started_at <= ? THEN 1 ELSE count + 1 END
    RETURNING count
  `).bind(key, now, resetBefore, now, resetBefore).first<{ count: number }>();
  return (row?.count ?? limit + 1) <= limit;
}

export async function logAccess(roomId: string, actorType: string, actorId: string, action: string) {
  const createdAt = Date.now();
  const db = await getDatabase();
  if (!db) {
    memory.pawlySecurityMemory!.logs.push({ roomId, actorType, actorId, action, createdAt });
    memory.pawlySecurityMemory!.logs.splice(0, Math.max(0, memory.pawlySecurityMemory!.logs.length - 200));
    return;
  }
  await db.prepare("INSERT INTO access_logs (id, room_id, actor_type, actor_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), roomId, actorType, actorId, action, createdAt).run();
}

async function getRoomById(id: string): Promise<RoomRecord | null> {
  const db = await getDatabase();
  if (!db) return memory.pawlySecurityMemory!.rooms.get(id) ?? null;
  const row = await db.prepare("SELECT id, code, owner_email, owner_name, e2ee_key_ciphertext, created_at FROM rooms WHERE id = ?")
    .bind(id).first<Record<string, unknown>>();
  return row ? mapRoom(row) : null;
}

async function encryptRoomKey(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${Buffer.from(iv).toString("base64url")}.${Buffer.from(ciphertext).toString("base64url")}`;
}

async function encryptionKey() {
  const configured = process.env.PAWLY_KEY_ENCRYPTION_SECRET;
  if (!configured && process.env.NODE_ENV === "production") throw new Error("Pawly room encryption is not configured");
  const material = new TextEncoder().encode(configured ?? "pawly-local-development-key-change-before-production");
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hashToken(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("base64url");
}

function randomSecret() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function mapRoom(row: Record<string, unknown>): RoomRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    ownerEmail: String(row.owner_email),
    ownerName: row.owner_name ? String(row.owner_name) : null,
    e2eeKeyCiphertext: String(row.e2ee_key_ciphertext),
    createdAt: Number(row.created_at),
  };
}

function mapDevice(row: Record<string, unknown>): DeviceRecord {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    name: String(row.name),
    tokenHash: String(row.token_hash),
    createdAt: Number(row.created_at),
    lastSeenAt: Number(row.last_seen_at),
    revokedAt: row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at),
  };
}

function mapPairing(row: Record<string, unknown>): PairingRecord {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    tokenHash: String(row.token_hash),
    expiresAt: Number(row.expires_at),
    usedAt: row.used_at === null || row.used_at === undefined ? null : Number(row.used_at),
    createdAt: Number(row.created_at),
  };
}
