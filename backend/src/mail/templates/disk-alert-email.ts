import { brand } from '@zuvo/config';
import type { MailMessage } from '../mailer.ts';

export interface DiskAlert {
  /** Used space of the disk that holds the media folder, 0–100. */
  percent: number;
  /** The folder that was measured, e.g. /var/data/zuvo. */
  path: string;
  /** Free space, in GiB. */
  freeGiB: number;
}

/** Disk usage at or above this many percent sends the alert (the API refuses uploads at 90). */
export const DISK_ALERT_PERCENT = 80;

export function shouldAlert(percent: number): boolean {
  return Number.isFinite(percent) && percent >= DISK_ALERT_PERCENT;
}

/** Plain operator email from the daily backup (deploy/scripts/backup.sh) when the disk passes 80%. */
export function diskAlertEmail(to: string, alert: DiskAlert, sentAt: Date): MailMessage {
  const subject = `${brand.name}: server disk ${alert.percent}% full`;
  const lines = [
    `The disk that holds ${brand.name}'s media (${alert.path}) is ${alert.percent}% full.`,
    `Free space: ${alert.freeGiB.toFixed(1)} GiB. Checked at ${sentAt.toISOString()}.`,
    '',
    'At 90% the app refuses new uploads (507 STORAGE_FULL).',
    'Free space or add disk soon. Steps: docs/runbooks/first-deploy.md, "Disk space".',
  ];
  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:Inter,Segoe UI,Roboto,sans-serif;color:#0F172A;padding:24px">
    ${lines.map((line) => (line ? `<p style="margin:0 0 8px">${line}</p>` : '')).join('\n    ')}
  </body>
</html>`;
  return { to, subject, html, text: lines.join('\n') };
}
