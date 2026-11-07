import type { LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { type FetchFailure, failure } from './types.ts';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface HopRequest {
  url: URL;
  /** The already-validated IP address the socket must connect to. */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  maxBytes: number;
  connectTimeoutMs: number;
  acceptContentType: ((mimeType: string | null) => boolean) | undefined;
  signal: AbortSignal;
  /** Maps an error seen while the request was running to a failure. */
  classifyError: (error: unknown) => FetchFailure;
}

export type HopResult =
  | { ok: true; kind: 'redirect'; location: string }
  | {
      ok: true;
      kind: 'response';
      status: number;
      mimeType: string | null;
      charset: string | null;
      body: Buffer;
    }
  | FetchFailure;

export class ConnectTimeoutError extends Error {
  constructor() {
    super('Connect timed out');
    this.name = 'ConnectTimeoutError';
  }
}

/**
 * A lookup that never asks DNS: it always answers with the address that was checked before the
 * request started. Node calls it for the socket connect, so a hostname whose DNS answer changes
 * between the check and the connect (DNS rebinding) cannot redirect the socket.
 */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      const all: LookupAddress[] = [{ address, family }];
      callback(null, all);
    } else {
      callback(null, address, family);
    }
  };
}

export function parseContentType(header: string | undefined): {
  mimeType: string | null;
  charset: string | null;
} {
  if (!header) return { mimeType: null, charset: null };
  const [type = '', ...params] = header.split(';');
  const mimeType = type.trim().toLowerCase() || null;
  let charset: string | null = null;
  for (const param of params) {
    const [key = '', value = ''] = param.split('=');
    if (key.trim().toLowerCase() === 'charset') {
      charset =
        value
          .trim()
          .replace(/^["']|["']$/g, '')
          .toLowerCase() || null;
    }
  }
  return { mimeType, charset };
}

function decodedStream(response: IncomingMessage): Readable | null {
  const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
  if (encoding === 'identity' || encoding === '') return response;
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(createGunzip());
  if (encoding === 'deflate') return response.pipe(createInflate());
  if (encoding === 'br') return response.pipe(createBrotliDecompress());
  return null;
}

/** Makes one request to an already-checked target and reads its body within the limits. */
export function requestHop(hop: HopRequest): Promise<HopResult> {
  return new Promise<HopResult>((resolve) => {
    let settled = false;
    const transport = hop.url.protocol === 'https:' ? https : http;
    const connectTimer = setTimeout(
      () => request.destroy(new ConnectTimeoutError()),
      hop.connectTimeoutMs,
    );

    const finish = (result: HopResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      // Stops any transfer still in progress (too large, redirect, error, refused type).
      if (result.ok && result.kind === 'response') return;
      request.destroy();
    };
    const settle = (result: HopResult) => {
      const first = !settled;
      finish(result);
      if (first) resolve(result);
    };

    const request = transport.request(
      hop.url,
      {
        method: 'GET',
        headers: hop.headers,
        lookup: pinnedLookup(hop.address, hop.family),
        signal: hop.signal,
        // A fresh connection per hop: a pooled socket could be connected to another address.
        agent: false,
      },
      (response) => handleResponse(hop, response, settle),
    );

    request.on('socket', (socket) => {
      if (!socket.connecting) return clearTimeout(connectTimer);
      const connected = hop.url.protocol === 'https:' ? 'secureConnect' : 'connect';
      socket.once(connected, () => clearTimeout(connectTimer));
    });
    request.on('error', (error) => settle(hop.classifyError(error)));
    request.end();
  });
}

/** Decides a response from its status and headers alone; null means "read the body". */
function earlyResult(
  hop: HopRequest,
  response: IncomingMessage,
  mimeType: string | null,
): HopResult | null {
  const status = response.statusCode ?? 0;
  if (REDIRECT_STATUSES.has(status)) {
    const location = response.headers.location;
    if (!location) return failure('http_error', 'Redirect without Location', status);
    return { ok: true, kind: 'redirect', location };
  }
  if (status < 200 || status > 299) return failure('http_error', `HTTP status ${status}`, status);
  if (hop.acceptContentType && !hop.acceptContentType(mimeType)) {
    return failure('content_type', `Content-Type ${mimeType ?? '(none)'} not accepted`);
  }
  // Refuse early when the size is declared, but never trust it: bytes are counted as they arrive.
  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > hop.maxBytes) {
    return failure('too_large', `Content-Length ${declared} exceeds ${hop.maxBytes}`);
  }
  return null;
}

function handleResponse(
  hop: HopRequest,
  response: IncomingMessage,
  settle: (result: HopResult) => void,
): void {
  const { mimeType, charset } = parseContentType(response.headers['content-type']);
  const early = earlyResult(hop, response, mimeType);
  const stream = early ? null : decodedStream(response);
  if (early || !stream) {
    settle(early ?? failure('network', 'Unsupported Content-Encoding'));
    return;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  stream.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > hop.maxBytes) {
      settle(failure('too_large', `Body exceeds ${hop.maxBytes} bytes`));
      stream.destroy();
      return;
    }
    chunks.push(chunk);
  });
  stream.on('end', () =>
    settle({
      ok: true,
      kind: 'response',
      status: response.statusCode ?? 0,
      mimeType,
      charset,
      body: Buffer.concat(chunks, total),
    }),
  );
  stream.on('error', (error) => settle(hop.classifyError(error)));
  response.on('error', (error) => settle(hop.classifyError(error)));
  response.on('aborted', () => settle(failure('network', 'Response aborted')));
}
