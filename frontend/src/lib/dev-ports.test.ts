import { describe, expect, it } from 'vitest';
import { devPorts } from './dev-ports';

describe('dev ports', () => {
  it('fall back to the defaults', () => {
    expect(devPorts({})).toEqual({
      dev: 5191,
      preview: 5192,
      apiTarget: 'http://127.0.0.1:4000',
    });
  });

  it('come from the environment, and the proxy follows the API port', () => {
    expect(
      devPorts({ ZUVO_DEV_PORT: '5197', ZUVO_PREVIEW_PORT: '5198', ZUVO_API_PORT: '4007' }),
    ).toEqual({ dev: 5197, preview: 5198, apiTarget: 'http://127.0.0.1:4007' });
  });

  it('let E2E name its own API', () => {
    expect(
      devPorts({ ZUVO_API_PORT: '4007', ZUVO_API_TARGET: 'http://127.0.0.1:4198' }).apiTarget,
    ).toBe('http://127.0.0.1:4198');
  });

  it('refuse what is not a port, and the same port twice', () => {
    expect(() => devPorts({ ZUVO_DEV_PORT: 'abc' })).toThrow(/ZUVO_DEV_PORT/);
    expect(() => devPorts({ ZUVO_API_PORT: '70000' })).toThrow(/ZUVO_API_PORT/);
    expect(() => devPorts({ ZUVO_DEV_PORT: '5197', ZUVO_PREVIEW_PORT: '5197' })).toThrow(/differ/);
  });
});
