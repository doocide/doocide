// Backups: the only copy of a decision that survives the browser clearing its storage.

import { lockBackup } from '../format/crypto';
import { backupEnvelope } from '../format/share';
import type { Decision } from '../format/types';
import { FILE_EXTENSION, downloadText, safeFileName } from './files';
import { markBackedUp } from './prefs';
import { currentLock } from './store';

export type BackupStatus = 'never' | 'changed' | 'current';

export function backupStatus(updatedAt: string, backedUpAt: string | undefined): BackupStatus {
  if (!backedUpAt) return 'never';
  return Date.parse(updatedAt) > Date.parse(backedUpAt) ? 'changed' : 'current';
}

/**
 * Saves the full decision, private notes included, to a file on this device. While the library lock is
 * on, the backup is locked too: encrypted with the library's data key, which travels wrapped with the
 * passphrase key, so the same passphrase opens it on any device.
 */
export async function downloadBackup(d: Decision) {
  const name = `${safeFileName(d.title, 'decision')}-backup${FILE_EXTENSION}`;
  const json = JSON.stringify(backupEnvelope(d));
  const locked = currentLock();
  const out = locked ? await lockBackup(json, locked.meta, locked.key) : backupEnvelope(d);
  downloadText(JSON.stringify(out, null, 2), name, 'application/json');
  markBackedUp(d.id);
}
