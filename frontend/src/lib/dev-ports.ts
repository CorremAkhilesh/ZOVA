/**
 * Ports for the Vite dev and preview servers, and the API the /v1 proxy forwards to. Every developer
 * on the shared machine picks their own in `frontend/.env.local` (see `.env.example`).
 * Read by vite.config.ts in Node; nothing here reaches the browser bundle.
 */
export interface DevPorts {
  dev: number;
  preview: number;
  /** Where /v1 and /socket.io go. */
  apiTarget: string;
}

export const DEFAULT_DEV_PORT = 5191;
export const DEFAULT_PREVIEW_PORT = 5192;
export const DEFAULT_API_PORT = 4000;

function port(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a port number (1-65535), got "${value}"`);
  }
  return parsed;
}

export function devPorts(env: Record<string, string | undefined>): DevPorts {
  const dev = port('ZUVO_DEV_PORT', env.ZUVO_DEV_PORT, DEFAULT_DEV_PORT);
  const preview = port('ZUVO_PREVIEW_PORT', env.ZUVO_PREVIEW_PORT, DEFAULT_PREVIEW_PORT);
  const api = port('ZUVO_API_PORT', env.ZUVO_API_PORT, DEFAULT_API_PORT);
  if (dev === preview) throw new Error('ZUVO_DEV_PORT and ZUVO_PREVIEW_PORT must differ');
  // E2E points the proxy at its own test API.
  const apiTarget = env.ZUVO_API_TARGET?.trim() || `http://127.0.0.1:${api}`;
  return { dev, preview, apiTarget };
}
