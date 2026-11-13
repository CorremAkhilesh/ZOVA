import { isIP } from 'node:net';
import { isBlockedHostname } from './address-policy.ts';
import { type FetchFailure, failure } from './types.ts';

export const MAX_URL_LENGTH = 2048;

export interface Target {
  ok: true;
  url: URL;
  /** Lower-case host without IPv6 brackets or trailing dot. */
  hostname: string;
  port: number;
  /** Set when the host is an IP literal (no DNS lookup is done). */
  ipLiteral: string | null;
}

/** Lower-case host without IPv6 brackets or a trailing dot. */
function bareHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function portOf(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * Parses and checks a URL before anything is resolved or connected. The WHATWG parser
 * canonicalises numeric hosts (`http://2130706433/`, `http://0x7f.1/`, `http://0177.0.0.1/`
 * all become `127.0.0.1`), so IP literals are checked in their canonical form.
 */
export function checkTarget(
  input: string,
  isAllowedPort: (port: number) => boolean,
): Target | FetchFailure {
  if (input.length > MAX_URL_LENGTH) return failure('invalid_url', 'URL is too long');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return failure('invalid_url', 'URL could not be parsed');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return failure('invalid_url', `Scheme ${url.protocol} is not allowed`);
  }
  if (url.username !== '' || url.password !== '') {
    return failure('invalid_url', 'URLs with credentials are not allowed');
  }
  const port = portOf(url);
  if (!isAllowedPort(port)) return failure('invalid_url', `Port ${port} is not allowed`);

  const hostname = bareHostname(url);
  if (hostname === '') return failure('invalid_url', 'URL has no host');

  if (isIP(hostname) !== 0) return { ok: true, url, hostname, port, ipLiteral: hostname };
  if (isBlockedHostname(hostname)) return failure('blocked', 'Host name is not allowed');
  return { ok: true, url, hostname, port, ipLiteral: null };
}
