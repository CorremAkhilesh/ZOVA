import { type ApiError, apiErrorSchema } from '@zuvo/protocol';
import type { z } from 'zod';

/** Any failed API call: HTTP error (with the server's ApiError), bad response, or network failure. */
export class ApiClientError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  readonly apiError: ApiError | undefined;

  constructor(status: number, message: string, apiError?: ApiError) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.apiError = apiError;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Calls the API (same origin; Vite proxies /v1 in dev) and validates the response with the
 * matching @zuvo/protocol schema. Errors always come out as ApiClientError.
 */
export async function apiRequest<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init: RequestInit = {},
): Promise<z.output<Schema>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiClientError(0, 'Cannot reach the server. Check your connection.');
  }

  const body = await readJson(response);
  if (!response.ok) {
    const apiError = apiErrorSchema.safeParse(body);
    if (apiError.success) {
      throw new ApiClientError(response.status, apiError.data.message, apiError.data);
    }
    throw new ApiClientError(response.status, `Request failed (${response.status})`);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError(response.status, 'Unexpected response from the server.');
  }
  return parsed.data;
}

export const apiGet = <Schema extends z.ZodType>(path: string, schema: Schema) =>
  apiRequest(path, schema, { method: 'GET' });

function jsonInit(method: string, body: unknown): RequestInit {
  // Fastify refuses an empty body that says it is JSON, so nothing to send means no such claim.
  if (body === undefined) return { method };
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export const apiPost = <Schema extends z.ZodType>(path: string, body: unknown, schema: Schema) =>
  apiRequest(path, schema, jsonInit('POST', body));

export const apiPatch = <Schema extends z.ZodType>(path: string, body: unknown, schema: Schema) =>
  apiRequest(path, schema, jsonInit('PATCH', body));

export const apiPut = <Schema extends z.ZodType>(path: string, body: unknown, schema: Schema) =>
  apiRequest(path, schema, jsonInit('PUT', body));

export const apiDelete = <Schema extends z.ZodType>(path: string, schema: Schema) =>
  apiRequest(path, schema, { method: 'DELETE' });

/** Builds a URL with query parameters, skipping empty values. */
export function withQuery(path: string, params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Multipart upload with progress (fetch cannot report upload progress). The response is validated
 * like every other call; errors come out as ApiClientError.
 */
export function apiUpload<Schema extends z.ZodType>(
  path: string,
  file: Blob,
  schema: Schema,
  onProgress?: (fraction: number) => void,
): Promise<z.output<Schema>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('accept', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () =>
      reject(new ApiClientError(0, 'Cannot reach the server. Check your connection.'));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const apiError = apiErrorSchema.safeParse(body);
        reject(
          apiError.success
            ? new ApiClientError(xhr.status, apiError.data.message, apiError.data)
            : new ApiClientError(xhr.status, `Request failed (${xhr.status})`),
        );
        return;
      }
      const parsed = schema.safeParse(body);
      if (parsed.success) resolve(parsed.data);
      else reject(new ApiClientError(xhr.status, 'Unexpected response from the server.'));
    };
    const form = new FormData();
    form.append('file', file, 'photo.jpg');
    xhr.send(form);
  });
}
