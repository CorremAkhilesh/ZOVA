import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertPortsFree } from '../../e2e/port-guard';

let server: Server | undefined;

const listen = () =>
  new Promise<number>((resolve) => {
    const created = createServer();
    server = created;
    created.listen(0, '127.0.0.1', () => resolve((created.address() as AddressInfo).port));
  });

beforeEach(() => {
  delete process.env.ZUVO_E2E_PORTS_CHECKED;
  delete process.env.TEST_WORKER_INDEX;
});

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  server = undefined;
  delete process.env.ZUVO_E2E_PORTS_CHECKED;
});

describe('the E2E port guard', () => {
  it('refuses to run when something already holds a port', async () => {
    const taken = await listen();
    await expect(assertPortsFree([taken])).rejects.toThrow(`Port ${taken} is already in use`);
  });

  it('lets the run go ahead when the ports are free, and only checks once', async () => {
    const port = await listen();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
    await expect(assertPortsFree([port])).resolves.toBeUndefined();
    expect(process.env.ZUVO_E2E_PORTS_CHECKED).toBe('1');

    // Later loads of the config see the run's own servers on these ports.
    const own = await listen();
    await expect(assertPortsFree([own])).resolves.toBeUndefined();
  });

  it('does not check inside a test worker, when the run’s own servers are up', async () => {
    const own = await listen();
    process.env.TEST_WORKER_INDEX = '0';
    await expect(assertPortsFree([own])).resolves.toBeUndefined();
  });
});
