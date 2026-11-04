import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Mailer } from '../mail/mailer.ts';
import { LocalDiskDriver } from '../storage/local-disk-driver.ts';
import { servicesPlugin } from './services.ts';

function mailer(verify: () => Promise<void>): Mailer {
  return { send: vi.fn(), verify: vi.fn(verify), close: vi.fn() };
}

async function start(fake: Mailer, verifyMailer: boolean) {
  const app = Fastify({ logger: false });
  const info = vi.spyOn(app.log, 'info');
  const warn = vi.spyOn(app.log, 'warn');
  await app.register(servicesPlugin, {
    storage: new LocalDiskDriver('.'),
    mailer: fake,
    verifyMailer,
  });
  await app.ready();
  return { app, info, warn };
}

describe('services plugin', () => {
  it('logs success when SMTP verification passes', async () => {
    const fake = mailer(async () => {});
    const { app, info } = await start(fake, true);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith('smtp connection verified'));
    await app.close();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('only warns (never crashes) when SMTP verification fails', async () => {
    const { app, warn } = await start(
      mailer(async () => Promise.reject(new Error('535'))),
      true,
    );
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'smtp verification failed: emails may not be delivered',
      ),
    );
    await app.close();
  });

  it('skips verification when disabled (tests)', async () => {
    const fake = mailer(async () => {});
    const { app } = await start(fake, false);
    expect(fake.verify).not.toHaveBeenCalled();
    await app.close();
  });
});
