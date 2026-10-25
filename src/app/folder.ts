// Shared folders: a cloud folder that syncs to people's computers, picked by them, where a group keeps
// its invite, its ballots and its results. There's still no server: the cloud service does the
// syncing, and Doocide reads or writes the folder only when someone taps a button. It never watches it.
//
// The only file that touches the browser's folder and file handles. Where the browser can't write to
// folders, files are downloaded instead, to be moved into the folder by hand, and folders are read by
// picking them (or a single file).
//
// What may go in the folder, and nothing else:
//   invite-<id>.doocide   the organizer's signed invite
//   results-<id>.doocide  the group's results, signed by the organizer, maybe locked with a passphrase
//   ballot-<random>.doocide  one person's ballot, signed and sealed so only the organizer can open it
// <id> is the start of the organizer's decision id, so one folder can hold several decisions. Ballot
// names are random (the start of the person's random voter id), never a name.

import { LIMITS } from '../format/limits';
import { assertShareable } from '../format/share';
import type { BallotEnvelope, Envelope, InviteEnvelope, PassphraseEnvelope, SealedEnvelope } from '../format/types';
import { FILE_EXTENSION, choose, downloadText } from './files';
import { deleteHandle, getHandle, putHandle } from './store';

// The parts of the browser's folder API that Doocide uses. Not all of it is in TypeScript's own types yet.
type Mode = 'read' | 'readwrite';

interface Writable {
  write(text: string): Promise<void>;
  close(): Promise<void>;
}

interface FileEntry {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<Writable>;
}

interface FolderEntry {
  kind: 'directory';
  name: string;
}

/** A folder handle as the browser hands it over (FileSystemDirectoryHandle). */
export interface FolderHandle {
  kind: 'directory';
  name: string;
  queryPermission?(d: { mode: Mode }): Promise<PermissionState>;
  requestPermission?(d: { mode: Mode }): Promise<PermissionState>;
  values(): AsyncIterable<FileEntry | FolderEntry>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileEntry>;
}

type Picker = (options?: { mode?: Mode; id?: string }) => Promise<FolderHandle>;

const picker = (): Picker | undefined => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;

/** This browser can write to a folder the person picks (and remember it). Elsewhere, files are downloaded. */
export const canUseFolders = () => typeof window !== 'undefined' && typeof picker() === 'function';

const isHandle = (v: unknown): v is FolderHandle =>
  typeof v === 'object' && v !== null && (v as FolderHandle).kind === 'directory' && typeof (v as FolderHandle).getFileHandle === 'function';

/** The folder remembered for this decision, or null. Asks nothing. */
export async function rememberedFolder(decisionId: string): Promise<FolderHandle | null> {
  const handle = await getHandle(decisionId);
  return isHandle(handle) ? handle : null;
}

/** Opens the system's folder picker (on a tap) and remembers the folder for this decision. null when cancelled. */
export async function connectFolder(decisionId: string): Promise<FolderHandle | null> {
  const pick = picker();
  if (!pick) return null;
  let handle: FolderHandle;
  try {
    handle = await pick({ mode: 'readwrite', id: 'doocide-shared' });
  } catch {
    return null;
  }
  await putHandle(decisionId, handle);
  return handle;
}

export const forgetFolder = (decisionId: string): Promise<void> => deleteHandle(decisionId);

/**
 * Whether Doocide may use the folder now. Browsers forget the permission after a restart; it's asked
 * again here, which only works during a tap.
 */
async function allowed(folder: FolderHandle, mode: Mode): Promise<boolean> {
  if (!folder.queryPermission || !folder.requestPermission) return true;
  if ((await folder.queryPermission({ mode })) === 'granted') return true;
  try {
    return (await folder.requestPermission({ mode })) === 'granted';
  } catch {
    return false;
  }
}

/** The start of an id, for a file name: letters and digits only. */
const idPart = (id: string, n: number) => id.replace(/[^A-Za-z0-9]/g, '').slice(0, n) || 'x';

export const inviteFileName = (decisionId: string) => `invite-${idPart(decisionId, 6)}${FILE_EXTENSION}`;
export const resultsFileName = (decisionId: string) => `results-${idPart(decisionId, 6)}${FILE_EXTENSION}`;
export const ballotFileName = (voterId: string) => `ballot-${idPart(voterId, 8)}${FILE_EXTENSION}`;
const isBallotFileName = (name: string) => name.startsWith('ballot-') && name.endsWith(FILE_EXTENSION);

/** Something to put in the shared folder. Encryption happens here, after the checks, never before. */
export type FolderFile =
  | { kind: 'invite'; env: InviteEnvelope }
  /** Ballots go in sealed or not at all: everyone with access to the folder could read them otherwise. */
  | { kind: 'ballot'; env: BallotEnvelope; seal: (json: string) => Promise<SealedEnvelope> }
  /** Group results, signed by the organizer, locked when the organizer set a passphrase. */
  | { kind: 'results'; env: Envelope; lock?: (json: string) => Promise<PassphraseEnvelope> };

/**
 * The one way into the shared folder: the envelope is checked like any share (assertShareable, so no
 * backups and no private notes), then sealed or locked, then named. Throws for anything else.
 */
export async function folderFile(file: FolderFile): Promise<{ name: string; text: string }> {
  const { env } = file;
  if (env.kind !== file.kind && !(file.kind === 'results' && env.kind === 'decision')) throw new Error('Not what it says it is');
  assertShareable(env);
  switch (file.kind) {
    case 'invite':
      return { name: inviteFileName(file.env.data.decision.id), text: JSON.stringify(file.env, null, 2) };
    case 'ballot': {
      if (typeof file.seal !== 'function') throw new Error('Ballots go in a shared folder sealed, or not at all');
      const sealed = await file.seal(JSON.stringify(file.env));
      if (sealed?.enc !== 'sealed') throw new Error('Ballots go in a shared folder sealed, or not at all');
      return { name: ballotFileName(file.env.data.voterId), text: JSON.stringify(sealed, null, 2) };
    }
    case 'results': {
      const r = file.env;
      if (r.kind !== 'decision' || !r.data.groupResult) throw new Error('Only group results go in the shared folder');
      if (!r.key || !r.sig) throw new Error('Results go in the shared folder signed');
      const out = file.lock ? await file.lock(JSON.stringify(r)) : r;
      return { name: resultsFileName(r.data.id), text: JSON.stringify(out, null, 2) };
    }
  }
}

export type Saved = 'written' | 'downloaded' | 'denied';

/** Writes the file into the folder, or, without one, downloads it to be moved into the folder by hand. */
export async function saveToFolder(folder: FolderHandle | null, file: FolderFile): Promise<Saved> {
  const { name, text } = await folderFile(file);
  if (!folder) {
    downloadText(text, name, 'application/json');
    return 'downloaded';
  }
  if (!(await allowed(folder, 'readwrite'))) return 'denied';
  const handle = await folder.getFileHandle(name, { create: true });
  const out = await handle.createWritable();
  await out.write(text);
  await out.close();
  return 'written';
}

/** File texts read from a folder, and how many files couldn't be read (too big, or not on this computer yet). */
export interface Read {
  texts: string[];
  failed: number;
}

async function readFile(file: File): Promise<string | null> {
  if (file.size > LIMITS.fileBytes) return null;
  try {
    return await file.text();
  } catch {
    return null;
  }
}

/** Every ballot file in the folder. 'denied': the person didn't allow it. */
export async function readBallots(folder: FolderHandle): Promise<Read | 'denied'> {
  if (!(await allowed(folder, 'read'))) return 'denied';
  const texts: string[] = [];
  let failed = 0;
  for await (const entry of folder.values()) {
    if (entry.kind !== 'file' || !isBallotFileName(entry.name)) continue;
    if (texts.length + failed >= LIMITS.ballots) {
      failed++;
      continue;
    }
    let text: string | null = null;
    try {
      text = await readFile(await entry.getFile());
    } catch {
      // Listed but not readable, e.g. a cloud file not downloaded yet.
    }
    if (text === null) failed++;
    else texts.push(text);
  }
  return { texts, failed };
}

/** One named file from the folder, or null when it isn't there (or can't be read). 'denied': the person didn't allow it. */
export async function readNamed(folder: FolderHandle, name: string): Promise<string | null | 'denied'> {
  if (!(await allowed(folder, 'read'))) return 'denied';
  try {
    return await readFile(await (await folder.getFileHandle(name)).getFile());
  } catch {
    return null;
  }
}

/**
 * Without the folder API: the person picks the folder, and the browser hands over its files. Only
 * ballot files are read. null when cancelled.
 */
export async function pickFolderBallots(): Promise<Read | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  const picked = await choose(input);
  if (!picked) return null;
  const files = picked.filter((f) => isBallotFileName(f.name));
  const texts: string[] = [];
  let failed = Math.max(0, files.length - LIMITS.ballots);
  for (const file of files.slice(0, LIMITS.ballots)) {
    const text = await readFile(file);
    if (text === null) failed++;
    else texts.push(text);
  }
  return { texts, failed };
}

// Opening a file with the installed app (a double-click on a computer, where the browser lets an
// installed web app handle .doocide files). The browser hands over a file handle; only its file is
// read, once, the same checked way as a picked file. The handle isn't kept.

interface LaunchParams {
  files?: readonly { kind: string; getFile?: () => Promise<File> }[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** Files opened with the installed app, one at a time. Browsers without file opening never call it. */
export function onOpenedFiles(open: (file: File) => void) {
  const queue = (window as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer(async ({ files }) => {
    const handle = files?.[0];
    if (handle?.kind !== 'file' || !handle.getFile) return;
    try {
      open(await handle.getFile());
    } catch {
      // Unreadable (moved, or permission withdrawn): nothing opens.
    }
  });
}
