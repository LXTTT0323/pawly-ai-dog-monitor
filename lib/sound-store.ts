export interface SavedSound {
  id: string;
  roomCode: string;
  label: string;
  createdAt: number;
  mimeType: string;
  blob: Blob;
}

const DB_NAME = "pawly-local-sounds";
const STORE_NAME = "sounds";
const MAX_SOUNDS_PER_ROOM = 6;

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
    request.onerror = () => reject(request.error ?? new Error("Could not open sound storage"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Sound storage failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Sound storage was interrupted"));
  });
}

export async function listSavedSounds(roomCode: string): Promise<SavedSound[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index("roomCode").getAll(roomCode);
    const sounds = await new Promise<SavedSound[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as SavedSound[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read saved sounds"));
    });
    return sounds.sort((left, right) => left.createdAt - right.createdAt);
  } finally {
    database.close();
  }
}

export async function saveSound(sound: SavedSound): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(sound);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  const sounds = await listSavedSounds(sound.roomCode);
  await Promise.all(sounds.slice(MAX_SOUNDS_PER_ROOM).map((item) => deleteSound(item.id)));
}

export async function deleteSound(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
