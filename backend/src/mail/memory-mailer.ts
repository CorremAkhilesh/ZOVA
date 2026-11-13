import type { Mailer, MailMessage } from './mailer.ts';

/** Test-mode mailer: keeps messages in memory so tests can read OTPs. Never used in production. */
export interface MemoryMailer extends Mailer {
  readonly outbox: MailMessage[];
  /** Most recent message sent to `to`, if any. */
  lastTo(to: string): MailMessage | undefined;
  clear(): void;
}

export function createMemoryMailer(): MemoryMailer {
  const outbox: MailMessage[] = [];
  return {
    outbox,
    async send(message) {
      outbox.push(message);
      return { messageId: `memory-${outbox.length}` };
    },
    async verify() {},
    close() {},
    lastTo(to) {
      const address = to.toLowerCase();
      return outbox.findLast((message) => message.to.toLowerCase() === address);
    },
    clear() {
      outbox.length = 0;
    },
  };
}

export function isMemoryMailer(mailer: Mailer): mailer is MemoryMailer {
  return 'outbox' in mailer && Array.isArray((mailer as MemoryMailer).outbox);
}
