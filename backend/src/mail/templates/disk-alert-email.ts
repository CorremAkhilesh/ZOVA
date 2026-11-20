import { brand } from '@zuvo/config';
import type { MailMessage } from '../mailer.ts';

export interface DiskAlert {
  /** Used space of the disk that holds the media folder, 0–100. */
  percent: number;
  /** The folder that was measured, e.g. /var/data/zuvo. */
  path: string;
  /** Free space, in GiB. */
  freeGiB: number;
  /** Sent by the API when it has just refused an upload, rather than by the daily check. */
  stopped?: boolean;
}

/** Above this share of the disk the API refuses new uploads (507 STORAGE_FULL). */
export const DISK_STOP_PERCENT = 85;

/** Disk usage at or above this many percent sends the daily alert (uploads stop at 85). */
export const DISK_ALERT_PERCENT = 80;

export function shouldAlert(percent: number): boolean {
  return Number.isFinite(percent) && percent >= DISK_ALERT_PERCENT;
}

/** Plain operator email from the daily backup (deploy/scripts/backup.sh) when the disk passes 80%. */
export function diskAlertEmail(to: string, alert: DiskAlert, sentAt: Date): MailMessage {
  const subject = alert.stopped
    ? `${brand.name}: server disk ${alert.percent}% full, uploads stopped`
    : `${brand.name}: server disk ${alert.percent}% full`;
  const lines = [
    `The disk that holds ${brand.name}'s media (${alert.path}) is ${alert.percent}% full.`,
    `Free space: ${alert.freeGiB.toFixed(1)} GiB. Checked at ${sentAt.toISOString()}.`,
    '',
    alert.stopped
      ? `New uploads are being refused now: the disk is past ${DISK_STOP_PERCENT}% (507 STORAGE_FULL).`
      : `At ${DISK_STOP_PERCENT}% the app refuses new uploads (507 STORAGE_FULL).`,
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
