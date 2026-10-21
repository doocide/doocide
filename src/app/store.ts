// Your decisions, stored in this browser only (IndexedDB). Falls back to memory when storage is
// blocked, and says so in the UI, so nobody thinks their work is saved when it isn't.

import type { Decision } from '../format/types';
import { validateDecision } from '../format/validate';

const DB = 'doocide';
const STORE = 'decisions';
/** Signing keys (see keys.ts). Private keys are kept as non-extractable CryptoKeys, never as text. */
const KEYS = 'keys';

let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<string, Decision>();
const memoryKeys = new Map<string, KeyRecord>();
let persistent = true;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    // Version 2 added the keys store.
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>, name = STORE): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(name, mode).objectStore(name));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** A signing key kept on this device. `id` is "device" or "decision:<decision id>". */
export interface KeyRecord {
  id: string;
  privateKey: CryptoKey;
  publicKey: string;
  createdAt: string;
}

export async function getKey(id: string): Promise<KeyRecord | undefined> {
  if (persistent) {
    try {
      const row = await run<KeyRecord | undefined>('readonly', (s) => s.get(id), KEYS);
      if (row) return row;
    } catch {
      persistent = false;
    }
  }
  return memoryKeys.get(id);
}

export async function putKey(record: KeyRecord): Promise<void> {
  memoryKeys.set(record.id, record);
  if (!persistent) return;
  try {
    await run('readwrite', (s) => s.put(record), KEYS);
  } catch {
    persistent = false;
  }
}

export async function deleteKey(id: string): Promise<void> {
  memoryKeys.delete(id);
  if (!persistent) return;
  try {
    await run('readwrite', (s) => s.delete(id), KEYS);
  } catch {
    persistent = false;
  }
}

export const isPersistent = () => persistent;

/** true: the browser promised not to clear Doocide's storage on its own. null: can't tell. */
export async function storagePersisted(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

/**
 * Asks the browser to keep Doocide's storage instead of clearing it under pressure or after
 * a while without use. Some browsers decide silently; one may ask the user once.
 */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function listDecisions(): Promise<Decision[]> {
  try {
    const rows = await run<unknown[]>('readonly', (s) => s.getAll());
    // Stored data is ours, but re-checking costs little and survives older or damaged entries.
    return rows.flatMap((row) => {
      try {
        return [validateDecision(row, 'backup')];
      } catch {
        return [];
      }
    });
  } catch {
    persistent = false;
    return [...memory.values()];
  }
}

export async function saveDecision(d: Decision): Promise<void> {
  memory.set(d.id, d);
  if (!persistent) return;
  try {
    await run('readwrite', (s) => s.put(d));
  } catch {
    persistent = false;
  }
}

export async function deleteDecision(id: string): Promise<void> {
  memory.delete(id);
  if (!persistent) return;
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    persistent = false;
  }
}
