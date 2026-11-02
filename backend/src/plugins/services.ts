import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Mailer } from '../mail/mailer.ts';
import type { StorageDriver } from '../storage/driver.ts';

declare module 'fastify' {
  interface FastifyInstance {
    storage: StorageDriver;
    mailer: Mailer;
  }
}

interface ServicesOptions {
  storage: StorageDriver;
  mailer: Mailer;
  /** Check SMTP on startup. A failure only logs a warning — it never stops the API. */
  verifyMailer: boolean;
}

async function services(app: FastifyInstance, options: ServicesOptions) {
  app.decorate('storage', options.storage);
  app.decorate('mailer', options.mailer);

  if (options.verifyMailer) {
    app.addHook('onReady', async () => {
      options.mailer
        .verify()
        .then(() => app.log.info('smtp connection verified'))
        .catch((error: unknown) =>
          app.log.warn({ err: error }, 'smtp verification failed: emails may not be delivered'),
        );
    });
  }
  app.addHook('onClose', async () => {
    options.mailer.close();
  });
}

export const servicesPlugin = fp(services, { name: 'services', fastify: '5.x' });
