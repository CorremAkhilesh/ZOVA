import type { AdminPushUser } from '@zuvo/protocol';

/** One CSV field: quoted when it holds a comma, quote or line break; a leading = + - @ is defused. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface CsvLabels {
  header: string[];
  on: string;
  off: string;
  app: string;
  browser: string;
  unknown: string;
}

/** Admin → Notifications as CSV: one row per person, their devices in one column. */
export function toCsv(users: AdminPushUser[], labels: CsvLabels): string {
  const rows = users.map((row) => {
    const devices = row.devices
      .map((device) => {
        const where =
          device.installed === null
            ? labels.unknown
            : device.installed
              ? labels.app
              : labels.browser;
        return `${device.label} (${where}, ${device.pushOn ? labels.on : labels.off})`;
      })
      .join('; ');
    return [
      row.user.displayName ?? '',
      row.user.email,
      row.user.username ?? '',
      row.pushOn ? labels.on : labels.off,
      String(row.devices.length),
      devices,
      row.lastSeenAt ?? '',
    ];
  });
  // A byte order mark, so Excel reads the names (Hindi too) as UTF-8.
  return `﻿${[labels.header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** Saves the text as a file through a temporary link. */
export function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
