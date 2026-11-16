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

  it('names the disk, the free space and what happens at 90%', () => {
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
    expect(mail.html).toContain('<p style="margin:0 0 8px">At 90% the app refuses new uploads');
  });
});
