// Your decisions, stored in this browser only (IndexedDB). Falls back to memory when storage is
// blocked, and says so in the UI, so nobody thinks their work is saved when it isn't.
//
// The optional library lock: when it's on, every stored decision is encrypted with a random data key
// (AES-GCM), and only that key, wrapped with a key made from the passphrase, is stored next to it. The
// passphrase itself is never stored. The unwrapped data key lives in memory only, non-extractable, and
// is dropped when the library is locked again. While the lock is on, nothing is ever written in plain.

import { decryptJson, encryptJson, type LockMeta } from '../format/crypto';
import type { Box, Decision, Kdf } from '../format/types';
import { parseJsonText, validateDecision } from '../format/validate';

const DB = 'doocide';
const STORE = 'decisions';
/** Keys (see keys.ts). Private keys are kept as non-extractable CryptoKeys, never as text. */
const KEYS = 'keys';
/** The library lock's settings and wrapped data key. */
const META = 'meta';
/** Shared folders picked for a decision (see folder.ts). Only the browser's handle to the folder, never decision data. */
const HANDLES = 'handles';

let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<string, Decision>();
const memoryKeys = new Map<string, KeyRecord | SecretRecord>();
const memoryHandles = new Map<string, unknown>();
let persistent = true;
let lock: LockMeta | null = null;
let dataKey: CryptoKey | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    // Version 2 added the keys store, version 3 the lock's meta store, version 4 the folder handles.
    const req = indexedDB.open(DB, 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [STORE, KEYS, META, HANDLES]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
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

/** A key pair kept on this device. `id` is "device", "decision:<decision id>" or "seal:<decision id>". */
export interface KeyRecord {
  id: string;
  privateKey: CryptoKey;
  publicKey: string;
  createdAt: string;
}

/**
 * A secret key kept on this device with the settings that made it: "results:<decision id>", the key
 * that opens a group's results file. Non-extractable, like every key here.
 */
export interface SecretRecord {
  id: string;
  secret: CryptoKey;
  kdf: Kdf;
  createdAt: string;
}

async function getRow<T>(name: string, id: string, memoryRows: Map<string, unknown>): Promise<T | undefined> {
  if (persistent) {
    try {
      const row = await run<T | undefined>('readonly', (s) => s.get(id), name);
      if (row) return row;
    } catch {
      persistent = false;
    }
  }
  return memoryRows.get(id) as T | undefined;
}

async function putRow<T extends { id: string }>(name: string, row: T, memoryRows: Map<string, unknown>): Promise<void> {
  memoryRows.set(row.id, row);
  if (!persistent) return;
  try {
    await run('readwrite', (s) => s.put(row), name);
  } catch {
    persistent = false;
  }
}

async function deleteRow(name: string, id: string, memoryRows: Map<string, unknown>): Promise<void> {
  memoryRows.delete(id);
  if (!persistent) return;
  try {
    await run('readwrite', (s) => s.delete(id), name);
  } catch {
    persistent = false;
  }
}

const isKeyRecord = (row: unknown): row is KeyRecord => typeof (row as KeyRecord | undefined)?.publicKey === 'string';
const isSecretRecord = (row: unknown): row is SecretRecord => typeof (row as SecretRecord | undefined)?.kdf === 'object';

export async function getKey(id: string): Promise<KeyRecord | undefined> {
  const row = await getRow<unknown>(KEYS, id, memoryKeys);
  return isKeyRecord(row) ? row : undefined;
}

export const putKey = (record: KeyRecord): Promise<void> => putRow(KEYS, record, memoryKeys);

export async function getSecret(id: string): Promise<SecretRecord | undefined> {
  const row = await getRow<unknown>(KEYS, id, memoryKeys);
  return isSecretRecord(row) ? row : undefined;
}

export const putSecret = (record: SecretRecord): Promise<void> => putRow(KEYS, record, memoryKeys);

export const deleteKey = (id: string): Promise<void> => deleteRow(KEYS, id, memoryKeys);

/** The shared folder picked for a decision, as the browser handed it over. folder.ts knows what's inside. */
export async function getHandle(decisionId: string): Promise<unknown> {
  return (await getRow<{ handle: unknown }>(HANDLES, decisionId, memoryHandles))?.handle;
}

/** Kept for this visit only when the browser can't store it: that says nothing about whether decisions can be saved. */
export async function putHandle(decisionId: string, handle: unknown): Promise<void> {
  const row = { id: decisionId, handle };
  memoryHandles.set(decisionId, row);
  if (!persistent) return;
  try {
    await run('readwrite', (s) => s.put(row), HANDLES);
  } catch {
    // Not every browser can store a folder handle; the folder is asked for again next time.
  }
}

export const deleteHandle = (decisionId: string): Promise<void> => deleteRow(HANDLES, decisionId, memoryHandles);

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
  await transaction([STORE, META, KEYS, HANDLES], (store) => {
    store(STORE).clear();
    store(META).clear();
    store(KEYS).clear();
    store(HANDLES).clear();
  });
  memory.clear();
  memoryKeys.clear();
  memoryHandles.clear();
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
