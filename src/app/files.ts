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

/** Opens the system file picker and returns the chosen file's text, size-checked. */
export function pickFileText(accept: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > LIMITS.fileBytes) return reject(new FormatError('too-big'));
      file.text().then(resolve, () => reject(new FormatError('bad-data')));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
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

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
