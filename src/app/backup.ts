// Backups: the only copy of a decision that survives the browser clearing its storage.

import { backupEnvelope } from '../format/share';
import type { Decision } from '../format/types';
import { FILE_EXTENSION, downloadText, safeFileName } from './files';
import { markBackedUp } from './prefs';

export type BackupStatus = 'never' | 'changed' | 'current';

export function backupStatus(updatedAt: string, backedUpAt: string | undefined): BackupStatus {
  if (!backedUpAt) return 'never';
  return Date.parse(updatedAt) > Date.parse(backedUpAt) ? 'changed' : 'current';
}

/** Saves the full decision, private notes included, to a file on this device. */
export function downloadBackup(d: Decision) {
  const name = `${safeFileName(d.title, 'decision')}-backup${FILE_EXTENSION}`;
  downloadText(JSON.stringify(backupEnvelope(d), null, 2), name, 'application/json');
  markBackedUp(d.id);
}
