import { describe, expect, it } from 'vitest';
import { backupStatus } from '../src/app/backup';

describe('backup status', () => {
  it('flags decisions that were never backed up', () => {
    expect(backupStatus('2026-10-20T10:00:00.000Z', undefined)).toBe('never');
  });

  it('flags decisions changed after their last backup', () => {
    expect(backupStatus('2026-10-20T10:00:01.000Z', '2026-10-20T10:00:00.000Z')).toBe('changed');
  });

  it('treats a backup made after the last change as current', () => {
    expect(backupStatus('2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z')).toBe('current');
    expect(backupStatus('2026-10-19T10:00:00.000Z', '2026-10-20T10:00:00.000Z')).toBe('current');
  });
});
