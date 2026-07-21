export type ClipTrigger = "movement" | "repeated_movement" | "sound";

export interface SavedClip {
  id: string;
  roomCode: string;
  createdAt: number;
  durationMs: number;
  trigger: ClipTrigger;
  mimeType: string;
  blob: Blob;
}

const DB_NAME = "pawly-local-clips";
const STORE_NAME = "clips";
const MAX_CLIPS_PER_ROOM = 20;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("roomCode", "roomCode", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open clip storage"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Clip storage failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Clip storage was interrupted"));
  });
}

export async function listSavedClips(roomCode: string): Promise<SavedClip[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index("roomCode").getAll(roomCode);
    const clips = await new Promise<SavedClip[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as SavedClip[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read saved clips"));
    });
    return clips.sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    database.close();
  }
}

export async function saveClip(clip: SavedClip): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(clip);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  const clips = await listSavedClips(clip.roomCode);
  await Promise.all(clips.slice(MAX_CLIPS_PER_ROOM).map((oldClip) => deleteClip(oldClip.id)));
}

export async function deleteClip(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export function clipFileName(clip: Pick<SavedClip, "id" | "createdAt" | "trigger" | "mimeType">): string {
  const extension = clip.mimeType.includes("mp4") ? "mp4" : "webm";
  return `pawly__${clip.id}__${clip.trigger}__${clip.createdAt}.${extension}`;
}

export function parseClipFileName(name: string): Pick<SavedClip, "id" | "createdAt" | "trigger"> | null {
  const match = /^pawly__([a-zA-Z0-9-]+)__(movement|repeated_movement|sound)__(\d+)\.(?:mp4|webm)$/.exec(name);
  if (!match) return null;
  return { id: match[1], trigger: match[2] as ClipTrigger, createdAt: Number(match[3]) };
}
