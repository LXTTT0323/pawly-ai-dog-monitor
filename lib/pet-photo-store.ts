export interface PetPhoto {
  id: string;
  petId: string;
  ownerEmail: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
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

interface R2ObjectBody {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

const memory = globalThis as typeof globalThis & {
  pawlyPetPhotoMemory?: {
    photos: Map<string, PetPhoto>;
    blobs: Map<string, ArrayBuffer>;
  };
};
memory.pawlyPetPhotoMemory ??= { photos: new Map(), blobs: new Map() };

let bindingsPromise: Promise<{ db: D1Database | null; bucket: R2Bucket | null }> | null = null;

async function getBindings() {
  if (!bindingsPromise) {
    bindingsPromise = (async () => {
      try {
        const moduleName = "cloudflare:workers";
        const cloudflare = await import(/* @vite-ignore */ moduleName) as { env?: { DB?: D1Database; PET_MEDIA?: R2Bucket } };
        const db = cloudflare.env?.DB ?? null;
        const bucket = cloudflare.env?.PET_MEDIA ?? null;
        if (process.env.NODE_ENV === "production" && (!db || !bucket)) throw new Error("Private pet photo storage is unavailable");
        return { db, bucket };
      } catch {
        if (process.env.NODE_ENV === "production") throw new Error("Private pet photo storage is unavailable");
        return { db: null, bucket: null };
      }
    })();
  }
  return bindingsPromise;
}

export async function listPetPhotos(ownerEmail: string, petId?: string): Promise<PetPhoto[]> {
  const { db } = await getBindings();
  if (!db) {
    return [...memory.pawlyPetPhotoMemory!.photos.values()]
      .filter((photo) => photo.ownerEmail === ownerEmail && (!petId || photo.petId === petId))
      .sort((left, right) => left.createdAt - right.createdAt);
  }
  const rows = petId
    ? await db.prepare("SELECT id, pet_id, owner_email, object_key, content_type, size_bytes, created_at FROM pet_photos WHERE owner_email = ? AND pet_id = ? ORDER BY created_at ASC")
      .bind(ownerEmail, petId).all<Record<string, unknown>>()
    : await db.prepare("SELECT id, pet_id, owner_email, object_key, content_type, size_bytes, created_at FROM pet_photos WHERE owner_email = ? ORDER BY created_at ASC")
      .bind(ownerEmail).all<Record<string, unknown>>();
  return (rows.results ?? []).map(mapPhoto);
}

export async function savePetPhoto(ownerEmail: string, petId: string, file: File): Promise<PetPhoto> {
  const { db, bucket } = await getBindings();
  const id = crypto.randomUUID();
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const objectKey = `pet-reference/${encodeURIComponent(ownerEmail)}/${petId}/${id}.${extension}`;
  const bytes = await file.arrayBuffer();
  const photo: PetPhoto = {
    id,
    petId,
    ownerEmail,
    objectKey,
    contentType: file.type,
    sizeBytes: bytes.byteLength,
    createdAt: Date.now(),
  };

  if (!db || !bucket) {
    memory.pawlyPetPhotoMemory!.photos.set(photo.id, photo);
    memory.pawlyPetPhotoMemory!.blobs.set(photo.objectKey, bytes);
    return photo;
  }

  await bucket.put(objectKey, bytes, { httpMetadata: { contentType: file.type } });
  try {
    await db.prepare(`
      INSERT INTO pet_photos (id, pet_id, owner_email, object_key, content_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(photo.id, petId, ownerEmail, objectKey, file.type, photo.sizeBytes, photo.createdAt).run();
  } catch (error) {
    await bucket.delete(objectKey).catch(() => undefined);
    throw error;
  }
  return photo;
}

export async function readPetPhoto(ownerEmail: string, petId: string, photoId: string) {
  const photo = (await listPetPhotos(ownerEmail, petId)).find((item) => item.id === photoId);
  if (!photo) return null;
  const { bucket } = await getBindings();
  if (!bucket) {
    const bytes = memory.pawlyPetPhotoMemory!.blobs.get(photo.objectKey);
    return bytes ? { photo, body: bytes as BodyInit } : null;
  }
  const object = await bucket.get(photo.objectKey);
  return object ? { photo, body: object.body as BodyInit } : null;
}

export async function deletePetPhoto(ownerEmail: string, petId: string, photoId: string) {
  const photo = (await listPetPhotos(ownerEmail, petId)).find((item) => item.id === photoId);
  if (!photo) return false;
  const { db, bucket } = await getBindings();
  if (!db || !bucket) {
    memory.pawlyPetPhotoMemory!.photos.delete(photo.id);
    memory.pawlyPetPhotoMemory!.blobs.delete(photo.objectKey);
    return true;
  }
  await bucket.delete(photo.objectKey);
  const result = await db.prepare("DELETE FROM pet_photos WHERE id = ? AND pet_id = ? AND owner_email = ?")
    .bind(photoId, petId, ownerEmail).run();
  return Boolean(result.meta?.changes);
}

function mapPhoto(row: Record<string, unknown>): PetPhoto {
  return {
    id: String(row.id),
    petId: String(row.pet_id),
    ownerEmail: String(row.owner_email),
    objectKey: String(row.object_key),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    createdAt: Number(row.created_at),
  };
}
