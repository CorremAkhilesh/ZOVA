import { brand } from '@zuvo/config';
import { createTransport } from 'nodemailer';
import type { Env } from '../config/env.ts';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ messageId: string }>;
  /** Checks the SMTP connection and credentials. */
  verify(): Promise<void>;
  close(): void;
}

type SmtpEnv = Pick<
  Env,
  'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASS' | 'MAIL_FROM'
>;

/** Pooled SMTP mailer. The From name always comes from brand.ts; the address from MAIL_FROM. */
export function createMailer(env: SmtpEnv): Mailer {
  const transport = createTransport({
    pool: true,
    maxConnections: 3,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  const from = { name: brand.email.senderName, address: env.MAIL_FROM };

  return {
    async send(message) {
      const info = await transport.sendMail({ from, ...message });
      return { messageId: info.messageId };
    },
    async verify() {
      await transport.verify();
    },
    close() {
      transport.close();
    },
  };
}
