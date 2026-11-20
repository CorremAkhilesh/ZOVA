import { brand } from '@zuvo/config';
import { describe, expect, it } from 'vitest';
import { DISK_ALERT_PERCENT, diskAlertEmail, shouldAlert } from './templates/disk-alert-email.ts';

describe('disk alert', () => {
  it('alerts from 80% on, never below or for nonsense', () => {
    expect(DISK_ALERT_PERCENT).toBe(80);
    expect(shouldAlert(79)).toBe(false);
    expect(shouldAlert(80)).toBe(true);
    expect(shouldAlert(97)).toBe(true);
    expect(shouldAlert(Number.NaN)).toBe(false);
  });

  it('names the disk, the free space and what happens at 85%', () => {
    const mail = diskAlertEmail(
      'novaadmin@corremadvisory.com',
      { percent: 83, path: '/var/data/zuvo', freeGiB: 120.46 },
      new Date('2026-11-15T02:30:00Z'),
    );
    expect(mail.to).toBe('novaadmin@corremadvisory.com');
    expect(mail.subject).toBe(`${brand.name}: server disk 83% full`);
    expect(mail.text).toContain('/var/data/zuvo) is 83% full');
    expect(mail.text).toContain('Free space: 120.5 GiB. Checked at 2026-11-15T02:30:00.000Z.');
    expect(mail.text).toContain('507 STORAGE_FULL');
    expect(mail.html).toContain('<p style="margin:0 0 8px">At 85% the app refuses new uploads');
  });

  it('says so when uploads have just stopped', () => {
    const mail = diskAlertEmail(
      'novaadmin@corremadvisory.com',
      { percent: 86, path: 'media storage', freeGiB: 14, stopped: true },
      new Date('2026-11-20T10:00:00Z'),
    );
    expect(mail.subject).toBe(`${brand.name}: server disk 86% full, uploads stopped`);
    expect(mail.text).toContain('New uploads are being refused now: the disk is past 85%');
  });
});
