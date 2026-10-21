// Your decisions, stored in this browser only (IndexedDB). Falls back to memory when storage is
// blocked, and says so in the UI, so nobody thinks their work is saved when it isn't.
//
// The optional library lock: when it's on, every stored decision is encrypted with a random data key
// (AES-GCM), and only that key, wrapped with a key made from the passphrase, is stored next to it. The
// passphrase itself is never stored. The unwrapped data key lives in memory only, non-extractable, and
// is dropped when the library is locked again. While the lock is on, nothing is ever written in plain.

import { decryptJson, encryptJson, type LockMeta } from '../format/crypto';
import type { Box, Decision } from '../format/types';
import { parseJsonText, validateDecision } from '../format/validate';

const DB = 'doocide';
const STORE = 'decisions';
/** Keys (see keys.ts). Private keys are kept as non-extractable CryptoKeys, never as text. */
const KEYS = 'keys';
/** The library lock's settings and wrapped data key. */
const META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<string, Decision>();
const memoryKeys = new Map<string, KeyRecord>();
let persistent = true;
let lock: LockMeta | null = null;
let dataKey: CryptoKey | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    // Version 2 added the keys store, version 3 the lock's meta store.
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
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

/** Several stores changed together or not at all. */
function transaction(names: string[], fn: (store: (name: string) => IDBObjectStore) => void): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(names, 'readwrite');
        fn((name) => tx.objectStore(name));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** A key kept on this device. `id` is "device", "decision:<decision id>" or "seal:<decision id>". */
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

/** A decision row while the library lock is on: the id in the open (it's the store's key), the rest encrypted. */
interface LockedRow extends Box {
  id: string;
}

const isLockedRow = (row: unknown): row is LockedRow =>
  typeof row === 'object' && row !== null && typeof (row as LockedRow).ct === 'string' && typeof (row as LockedRow).iv === 'string';

async function readRow(row: unknown): Promise<Decision | null> {
  try {
    // Stored data is ours, but re-checking costs little and survives older or damaged entries.
    if (!isLockedRow(row)) return validateDecision(row, 'backup');
    if (!dataKey) return null;
    return validateDecision(parseJsonText(await decryptJson(dataKey, row)), 'backup');
  } catch {
    return null;
  }
}

export async function listDecisions(): Promise<Decision[]> {
  try {
    const rows = await run<unknown[]>('readonly', (s) => s.getAll());
    return (await Promise.all(rows.map(readRow))).filter((d): d is Decision => d !== null);
  } catch {
    persistent = false;
    return [...memory.values()];
  }
}

export async function saveDecision(d: Decision): Promise<void> {
  memory.set(d.id, d);
  if (!persistent) return;
  // Locked and no key in memory: write nothing rather than anything in plain.
  if (lock && !dataKey) return;
  try {
    const row = lock && dataKey ? { id: d.id, ...(await encryptJson(dataKey, d)) } : d;
    await run('readwrite', (s) => s.put(row));
  } catch {
    persistent = false;
  }
}

// The library lock

/** Reads whether the library lock is on. Call once at start, before listing decisions. */
export async function readLock(): Promise<LockMeta | null> {
  try {
    const row = await run<(LockMeta & { id: string }) | undefined>('readonly', (s) => s.get('lock'), META);
    lock = row ? { kdf: row.kdf, wrapped: row.wrapped } : null;
  } catch {
    lock = null;
  }
  return lock;
}

export const lockOn = () => lock !== null;

/** The lock's settings and the data key in memory, for backups made while the library is unlocked. */
export const currentLock = (): { meta: LockMeta; key: CryptoKey } | null => (lock && dataKey ? { meta: lock, key: dataKey } : null);

/** After the passphrase opened the lock: decisions can be read and written again. */
export function setDataKey(key: CryptoKey) {
  dataKey = key;
}

/** Locks the library again: the data key is dropped from memory, along with every decision. */
export function forgetDataKey() {
  dataKey = null;
  memory.clear();
}

/**
 * Turns the lock on: every stored row, whatever it holds, is encrypted with the new data key and
 * written back together with the lock's settings, in one transaction.
 */
export async function turnLockOn(meta: LockMeta, key: CryptoKey): Promise<void> {
  const rows = await run<unknown[]>('readonly', (s) => s.getAll());
  const locked = await Promise.all(rows.filter((r): r is { id: string } => typeof (r as { id?: unknown })?.id === 'string').map(async (r) => ({ id: r.id, ...(await encryptJson(key, r)) })));
  await transaction([STORE, META], (store) => {
    for (const row of locked) store(STORE).put(row);
    store(META).put({ id: 'lock', ...meta, createdAt: new Date().toISOString() });
  });
  lock = meta;
  dataKey = key;
}

/** Turns the lock off: every row is decrypted and written back in plain, and the lock's settings are deleted, in one transaction. */
export async function turnLockOff(): Promise<void> {
  if (!dataKey) throw new Error('Unlock first');
  const key = dataKey;
  const rows = await run<unknown[]>('readonly', (s) => s.getAll());
  const plain: unknown[] = [];
  for (const row of rows) plain.push(isLockedRow(row) ? parseJsonText(await decryptJson(key, row)) : row);
  await transaction([STORE, META], (store) => {
    for (const row of plain) store(STORE).put(row);
    store(META).delete('lock');
  });
  lock = null;
}

/** For a forgotten passphrase: deletes every decision, the lock and every key in this browser. It can't be undone. */
export async function eraseEverything(): Promise<void> {
  await transaction([STORE, META, KEYS], (store) => {
    store(STORE).clear();
    store(META).clear();
    store(KEYS).clear();
  });
  memory.clear();
  memoryKeys.clear();
  lock = null;
  dataKey = null;
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
