/** Why a fetch made by `safeFetch` failed. */
export type FetchFailureReason =
  /** Not a parsable http(s) URL, has credentials, or uses a disallowed port. */
  | 'invalid_url'
  /** The host is a blocked name or resolves to a blocked (private, loopback, …) address. */
  | 'blocked'
  /** The overall deadline or the connect timeout passed. */
  | 'timeout'
  /** The body (after decompression) is larger than allowed. */
  | 'too_large'
  | 'too_many_redirects'
  /** The final response has a non-2xx status (see `status`). */
  | 'http_error'
  /** DNS failure, connection refused/reset, TLS error, malformed response. */
  | 'network'
  /** The response's Content-Type was refused by the caller's `acceptContentType`. */
  | 'content_type';

export type PreviewFailureReason =
  | Exclude<FetchFailureReason, 'content_type'>
  | 'not_html'
  | 'empty';

export type ImageFailureReason = Exclude<FetchFailureReason, 'content_type'> | 'not_image';

/** A failed result. `message` is for logs only; never show it to users verbatim. */
export interface Failure<R extends string> {
  ok: false;
  reason: R;
  message: string;
  /** HTTP status, for `http_error`. */
  status?: number;
}

export type FetchFailure = Failure<FetchFailureReason>;
export type PreviewFailure = Failure<PreviewFailureReason>;
export type ImageFailure = Failure<ImageFailureReason>;

/** Resolves a hostname to every IP address it has (A and AAAA). */
export type ResolveHost = (hostname: string) => Promise<string[]>;

/** True when connecting to this IP address is allowed. */
export type AddressPolicy = (address: string) => boolean;

export interface SafeFetchOptions {
  /** Overall deadline for DNS, connect, redirects and body. Default 5000 ms. */
  timeoutMs?: number;
  /** Deadline for the TCP (and TLS) connect of each hop. Default 3000 ms. */
  connectTimeoutMs?: number;
  /** Maximum body size in bytes, after decompression. Default 1 MB. */
  maxBytes?: number;
  /** Maximum number of redirects followed. Default 3. */
  maxRedirects?: number;
  /** `Accept` header. Default `text/html,application/xhtml+xml`. */
  accept?: string;
  /** Checked on the final response before the body is read; `false` → `content_type`. */
  acceptContentType?: (mimeType: string | null) => boolean;
  /** DNS resolver. Default: the system resolver (`dns.lookup`, all addresses). */
  resolve?: ResolveHost;
  /** IP address policy. Default `isPublicAddress` (blocks private/reserved ranges). */
  isAllowedAddress?: AddressPolicy;
  /** Port policy. Default `isAllowedPort` (80, 443 and 1024–65535). */
  isAllowedPort?: (port: number) => boolean;
  /** Extra caller-side cancellation. */
  signal?: AbortSignal;
}

export interface SafeResponse {
  ok: true;
  /** Final URL, after redirects. */
  url: string;
  status: number;
  /** Lower-cased MIME type without parameters, or null when absent. */
  mimeType: string | null;
  /** The `charset` parameter of Content-Type, lower-cased, or null. */
  charset: string | null;
  body: Buffer;
}

export type SafeFetchResult = SafeResponse | FetchFailure;

export interface LinkPreview {
  ok: true;
  /** Final URL, after redirects. */
  url: string;
  title: string | null;
  description: string | null;
  siteName: string;
  /** Absolute http(s) URL of the preview image, not yet fetched. */
  imageUrl: string | null;
  /** og:url, when it is an absolute http(s) URL. */
  canonicalUrl: string | null;
}

export type LinkPreviewResult = LinkPreview | PreviewFailure;

export interface PreviewImage {
  ok: true;
  bytes: Buffer;
  width: number;
  height: number;
  contentType: 'image/webp';
}

export type PreviewImageResult = PreviewImage | ImageFailure;

export function failure<R extends string>(reason: R, message: string, status?: number): Failure<R> {
  return status === undefined
    ? { ok: false, reason, message }
    : { ok: false, reason, message, status };
}
