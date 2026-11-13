import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { brand } from '@zuvo/config';
import { isAllowedPort, isPublicAddress } from './address-policy.ts';
import { ConnectTimeoutError, requestHop } from './http-request.ts';
import { checkTarget, type Target } from './target.ts';
import {
  type AddressPolicy,
  type FetchFailure,
  failure,
  type ResolveHost,
  type SafeFetchOptions,
  type SafeFetchResult,
} from './types.ts';

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 5_000,
  connectTimeoutMs: 3_000,
  maxBytes: 1024 * 1024,
  maxRedirects: 3,
  accept: 'text/html,application/xhtml+xml',
} as const;

/** Generic, honest crawler User-Agent; the product name comes from the brand config. */
export const USER_AGENT = `Mozilla/5.0 (compatible; ${brand.name}LinkPreview/1.0)`;

/** The system resolver, returning every A and AAAA address. */
export const systemResolve: ResolveHost = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/**
 * Resolves the target and checks **every** address; one blocked address blocks the whole
 * host (an attacker controls the order of DNS answers). The first address is then pinned.
 */
async function resolveTarget(
  target: Target,
  resolve: ResolveHost,
  isAllowedAddress: AddressPolicy,
  signal: AbortSignal,
  classify: (error: unknown) => FetchFailure,
): Promise<{ address: string; family: 4 | 6 } | FetchFailure> {
  let addresses: string[];
  if (target.ipLiteral) {
    addresses = [target.ipLiteral];
  } else {
    try {
      addresses = await Promise.race([resolve(target.hostname), abortPromise(signal)]);
    } catch (error) {
      return signal.aborted ? classify(error) : failure('network', 'DNS lookup failed');
    }
  }
  const [first] = addresses;
  if (first === undefined) return failure('network', 'DNS returned no addresses');
  for (const address of addresses) {
    if (isIP(address) === 0 || !isAllowedAddress(address)) {
      return failure('blocked', 'Host resolves to a blocked address');
    }
  }
  return { address: first, family: isIP(first) === 6 ? 6 : 4 };
}

type Settings = Required<Omit<SafeFetchOptions, 'signal' | 'acceptContentType'>> &
  Pick<SafeFetchOptions, 'signal' | 'acceptContentType'>;

function settingsFrom(options: SafeFetchOptions): Settings {
  return {
    ...SAFE_FETCH_DEFAULTS,
    resolve: systemResolve,
    isAllowedAddress: isPublicAddress,
    isAllowedPort,
    ...options,
  };
}

function errorClassifier(
  settings: Settings,
  deadline: AbortSignal,
  signal: AbortSignal,
): (error: unknown) => FetchFailure {
  return (error) => {
    if (deadline.aborted) {
      return failure('timeout', `No complete response within ${settings.timeoutMs} ms`);
    }
    if (error instanceof ConnectTimeoutError) {
      return failure('timeout', `Connect took longer than ${settings.connectTimeoutMs} ms`);
    }
    if (signal.aborted) return failure('network', 'Request was cancelled');
    return failure('network', error instanceof Error ? error.message : 'Request failed');
  };
}

/** The absolute URL of the next hop (relative Locations resolve against the current URL). */
function redirectTarget(
  location: string,
  base: URL,
  followed: number,
  maxRedirects: number,
): string | FetchFailure {
  if (followed >= maxRedirects) {
    return failure('too_many_redirects', `More than ${maxRedirects} redirects`);
  }
  const next = URL.parse(location, base.href);
  return next ? next.href : failure('invalid_url', 'Redirect Location could not be parsed');
}

/**
 * GETs an untrusted http(s) URL with SSRF protection: scheme/credential/port checks, DNS
 * resolved here with every address checked against the blocklist, the socket pinned to the
 * checked address (defeats DNS rebinding; Host header and TLS SNI keep the hostname), manual
 * redirects re-checked hop by hop, an overall deadline, a connect timeout and a byte cap that
 * aborts the transfer as soon as it is exceeded.
 */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const settings = settingsFrom(options);
  const deadline = AbortSignal.timeout(settings.timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  const classifyError = errorClassifier(settings, deadline, signal);
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: settings.accept,
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en;q=1, hi;q=0.8, *;q=0.5',
  };

  let current = input;
  for (let redirects = 0; ; redirects++) {
    if (signal.aborted) return classifyError(signal.reason);
    const target = checkTarget(current, settings.isAllowedPort);
    if (!target.ok) return target;
    const pinned = await resolveTarget(
      target,
      settings.resolve,
      settings.isAllowedAddress,
      signal,
      classifyError,
    );
    if ('ok' in pinned) return pinned;

    const result = await requestHop({
      url: target.url,
      address: pinned.address,
      family: pinned.family,
      headers,
      maxBytes: settings.maxBytes,
      connectTimeoutMs: settings.connectTimeoutMs,
      acceptContentType: settings.acceptContentType,
      signal,
      classifyError,
    });
    if (!result.ok) return result;
    if (result.kind === 'response') {
      const { status, mimeType, charset, body } = result;
      return { ok: true, url: target.url.href, status, mimeType, charset, body };
    }
    const next = redirectTarget(result.location, target.url, redirects, settings.maxRedirects);
    if (typeof next !== 'string') return next;
    current = next;
  }
}
