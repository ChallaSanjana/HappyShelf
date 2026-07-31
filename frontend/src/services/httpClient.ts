export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Thrown for any non-2xx response, carrying the status so callers can branch
 * on it instead of string-matching a message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type UnauthorizedHandler = (reason: string) => void;

let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Registers the app-wide reaction to an expired or revoked session.
 *
 * Nothing used to handle 401/403 at all: once a token expired — or, now that
 * the backend can revoke them, once a member was demoted or deactivated —
 * every screen simply showed "Failed to fetch items" forever, with no way
 * back short of manually clearing localStorage. AuthContext registers a
 * handler here that clears the session and returns the user to the login
 * screen with an explanation.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
  }
  return fallback;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Message used when the server sends no usable error text. */
  fallbackError?: string;
  /**
   * Set for the login/register calls, whose 401 means "wrong password" —
   * not "your session died", so they must not trigger a global logout.
   */
  skipAuthRedirect?: boolean;
  signal?: AbortSignal;
}

/**
 * Single entry point for every API call.
 *
 * Centralising this is what makes session handling possible at all: each
 * endpoint previously duplicated its own fetch + error parsing, so there was
 * nowhere to notice that the session had died.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, fallbackError = 'Request failed', skipAuthRedirect, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    // fetch only rejects on a genuine network failure, which is worth
    // distinguishing from a server-side error in the UI.
    throw new ApiError(
      'Could not reach the server. Check your connection and try again.',
      0,
      null
    );
  }

  if (response.ok) {
    return (await parseBody(response)) as T;
  }

  const errorBody = await parseBody(response);
  const message = messageFrom(errorBody, fallbackError);

  // 401 means the token is missing, expired, or revoked. 403 is normally an
  // ordinary permission denial and must NOT log anyone out — except when the
  // account itself has been deactivated, which the backend says explicitly.
  const sessionEnded =
    response.status === 401 ||
    (response.status === 403 && /deactivated/i.test(message));

  if (sessionEnded && !skipAuthRedirect) {
    onUnauthorized?.(message);
  }

  throw new ApiError(message, response.status, errorBody);
}
