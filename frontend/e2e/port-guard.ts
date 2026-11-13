import { createServer } from 'node:net';

const isFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

/**
 * Tests must only ever talk to servers they started themselves. On a shared machine whatever already
 * holds a port may be someone's real API on a real database, so a taken port stops the run.
 */
export async function assertPortsFree(ports: number[]): Promise<void> {
  // Playwright loads this config again in each worker, when its own servers hold these ports.
  if (process.env.TEST_WORKER_INDEX !== undefined || process.env.ZUVO_E2E_PORTS_CHECKED) return;
  for (const port of ports) {
    if (!(await isFree(port))) {
      throw new Error(
        `Port ${port} is already in use, so these tests will not run: they only talk to servers they ` +
          'start themselves. Stop what is using it, or choose others with E2E_API_PORT and E2E_WEB_PORT.',
      );
    }
  }
  process.env.ZUVO_E2E_PORTS_CHECKED = '1';
}
