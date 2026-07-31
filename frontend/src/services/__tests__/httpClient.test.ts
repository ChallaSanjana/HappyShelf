import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, ApiError, setUnauthorizedHandler } from '../httpClient';

function jsonResponse(status: number, body: unknown) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiRequest', () => {
  beforeEach(() => {
    setUnauthorizedHandler(null);
    localStorage.clear();
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
  });

  test('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { items: [1, 2] })));
    await expect(apiRequest('/inventory/items')).resolves.toEqual({ items: [1, 2] });
  });

  test('attaches the bearer token when one is stored', async () => {
    localStorage.setItem('token', 'tok-123');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/inventory/items');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok-123');
  });

  test('omits the Authorization header when signed out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/login', { method: 'POST', body: {} });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  test("surfaces the server's error message", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'Quantity must be positive' })));
    await expect(apiRequest('/inventory/items')).rejects.toThrow('Quantity must be positive');
  });

  test('falls back to the supplied message when the body has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(apiRequest('/x', { fallbackError: 'Could not load' })).rejects.toThrow('Could not load');
  });

  test('exposes the status code on the thrown error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { error: 'Item not found' })));

    await expect(apiRequest('/inventory/items/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
  });

  test('reports a network failure distinctly from a server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await apiRequest('/x').then(
      () => null,
      (e: unknown) => e as ApiError
    );
    expect(error?.status).toBe(0);
    expect(error?.message).toMatch(/Could not reach the server/);
  });
});

describe('session expiry handling', () => {
  beforeEach(() => setUnauthorizedHandler(null));
  afterEach(() => setUnauthorizedHandler(null));

  test('a 401 ends the session', async () => {
    // Nothing handled 401 before: an expired token left every screen stuck
    // on "Failed to fetch items" with no way back.
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Session expired. Please log in again.' })));

    await expect(apiRequest('/inventory/items')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledWith('Session expired. Please log in again.');
  });

  test('an ordinary 403 does NOT end the session', async () => {
    // A Viewer being told they cannot create items is a permission denial,
    // not a dead session — logging them out would be absurd.
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'Forbidden: Access restricted to: Admin, Manager, Staff' })));

    await expect(apiRequest('/inventory/items', { method: 'POST', body: {} })).rejects.toThrow();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  test('a "deactivated" 403 DOES end the session', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'This account has been deactivated' })));

    await expect(apiRequest('/inventory/items')).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalled();
  });

  test('a failed login does not end the session', async () => {
    // Login's 401 means "wrong password"; treating it as an expiry would
    // fire a spurious "your session ended" notice on a fresh sign-in attempt.
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Invalid email or password' })));

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: {}, skipAuthRedirect: true })
    ).rejects.toThrow('Invalid email or password');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  test('no handler registered is not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'nope' })));
    await expect(apiRequest('/x')).rejects.toThrow('nope');
  });
});
