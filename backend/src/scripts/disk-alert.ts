/**
 * Emails every ADMIN_EMAILS address when the disk passes 80%. Called by the daily backup
 * (deploy/scripts/backup.sh), inside the api container:
 *   node dist/scripts/disk-alert.js --percent 83 --free-gib 120.5 --path /var/data/zuvo
 * Below 80% it does nothing.
 */
import { parseArgs } from 'node:util';
import { loadEnv } from '../config/env.ts';
import { createMailer } from '../mail/mailer.ts';
import { diskAlertEmail, shouldAlert } from '../mail/templates/disk-alert-email.ts';

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      percent: { type: 'string' },
      'free-gib': { type: 'string', default: '0' },
      path: { type: 'string', default: '/var/data/zuvo' },
    },
  });
  const percent = Number(values.percent);
  if (!shouldAlert(percent)) {
    process.stdout.write(`disk ${values.percent ?? '?'}%: below the alert level, no email\n`);
    return;
  }
  const env = loadEnv();
  const mailer = createMailer(env);
  try {
    const alert = {
      percent,
      path: values.path,
      freeGiB: Number(values['free-gib']) || 0,
      stopPercent: env.STORAGE_GUARD_PERCENT,
    };
    for (const to of env.ADMIN_EMAILS) {
      await mailer.send(diskAlertEmail(to, alert, new Date()));
    }
    process.stdout.write(`disk ${percent}%: alert sent to ${env.ADMIN_EMAILS.length} admin(s)\n`);
  } finally {
    mailer.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `disk-alert failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
