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
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export const apiPost = <Schema extends z.ZodType>(path: string, body: unknown, schema: Schema) =>
  apiRequest(path, schema, jsonInit('POST', body));

export const apiPatch = <Schema extends z.ZodType>(path: string, body: unknown, schema: Schema) =>
  apiRequest(path, schema, jsonInit('PATCH', body));
