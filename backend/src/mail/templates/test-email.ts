import { brand } from '@zuvo/config';
import type { MailMessage } from '../mailer.ts';

/** A simple branded email used to check SMTP delivery end to end. */
export function testEmail(to: string, environment: string, sentAt: Date): MailMessage {
  const time = sentAt.toISOString();
  const subject = `${brand.name} test email`;
  const text = [
    `This is a test email from ${brand.name}.`,
    '',
    `Environment: ${environment}`,
    `Sent at: ${time}`,
    '',
    'If you received this, SMTP delivery works.',
    '',
    `${brand.name} — ${brand.tagline}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#F5F6FA;font-family:Inter,Segoe UI,Roboto,sans-serif;color:#0F172A">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden">
      <tr><td style="background:${brand.colors.primary};padding:20px 24px;color:#FFFFFF;font-size:20px;font-weight:700">${brand.name}</td></tr>
      <tr><td style="padding:24px">
        <p style="margin:0 0 12px;font-size:16px">This is a test email from <strong>${brand.name}</strong>.</p>
        <p style="margin:0 0 12px;font-size:14px;color:#5B6476">Environment: ${environment}<br>Sent at: ${time}</p>
        <p style="margin:0;font-size:14px">If you received this, SMTP delivery works.</p>
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #E2E5EE;font-size:12px;color:#5B6476">${brand.name} — ${brand.tagline}</td></tr>
    </table>
  </body>
</html>`;

  return { to, subject, html, text };
}
