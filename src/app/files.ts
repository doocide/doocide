// Saving and opening files on the user's own device.

import { LIMITS } from '../format/limits';
import { FormatError } from '../format/validate';

export const FILE_EXTENSION = '.doocide';

export function safeFileName(title: string, fallback: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return base || fallback;
}

export function downloadText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Opens the system file picker for a file input and waits for the answer: the chosen files, or null
 * when cancelled. The input sits in the page, hidden, while the picker is open: Safari can drop the
 * answer for an input that isn't in the page.
 */
export function choose(input: HTMLInputElement): Promise<File[] | null> {
  return new Promise((resolve) => {
    const done = (files: File[] | null) => {
      input.remove();
      resolve(files?.length ? files : null);
    };
    input.hidden = true;
    input.addEventListener('change', () => done([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

function fileInput(accept: string, multiple = false): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.multiple = multiple;
  return input;
}

/**
 * A file's text, size-checked: the one way in for files picked, dropped on the page, opened with an
 * installed Doocide, or shared to it from another app.
 */
export async function readFileText(file: Blob): Promise<string> {
  if (file.size > LIMITS.fileBytes) throw new FormatError('too-big');
  try {
    return await file.text();
  } catch {
    throw new FormatError('bad-data');
  }
}

/** Opens the system file picker and returns the chosen file's text, size-checked. */
export async function pickFileText(accept: string): Promise<string | null> {
  const file = (await choose(fileInput(accept)))?.[0];
  return file ? readFileText(file) : null;
}

/**
 * Opens the system file picker for several files at once (ballots, for example). Returns each file's
 * text; files that are too big or unreadable are counted in `failed`, not read.
 */
export async function pickFilesText(accept: string): Promise<{ texts: string[]; failed: number } | null> {
  const files = await choose(fileInput(accept, true));
  return files ? readFilesText(files) : null;
}

/** Several files' text (picked or dropped at once); files that are too big or unreadable are counted in `failed`, not read. */
export async function readFilesText(files: File[]): Promise<{ texts: string[]; failed: number }> {
  const texts: string[] = [];
  let failed = Math.max(0, files.length - LIMITS.ballots);
  for (const file of files.slice(0, LIMITS.ballots)) {
    if (file.size > LIMITS.fileBytes) {
      failed++;
      continue;
    }
    try {
      texts.push(await file.text());
    } catch {
      failed++;
    }
  }
  return { texts, failed };
}

export const canShareNatively = () => typeof navigator.share === 'function';

export async function shareNatively(data: ShareData): Promise<boolean> {
  try {
    await navigator.share(data);
    return true;
  } catch {
    return false;
  }
}

/** A Doocide file, ready to save or send: the same text a download would hold. */
export const doocideFile = (text: string, name: string) => new File([text], `${name}${FILE_EXTENSION}`, { type: 'application/json' });

/**
 * Whether this browser can hand a Doocide file to the device's share sheet. Some only share pictures,
 * sound, video, text and PDFs, and refuse other files; those save it instead.
 */
export function canShareFile(file: File = doocideFile('{}', 'test')): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** The device's share sheet with a file and a line on how to open it. Must follow a tap, with nothing slow in between. */
export async function shareFile(file: File, text: string): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share({ files: [file], text });
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** Saves a file to the device's downloads. */
export function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
