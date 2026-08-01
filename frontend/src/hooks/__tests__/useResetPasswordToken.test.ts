import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResetPasswordToken } from '../useResetPasswordToken';

describe('useResetPasswordToken', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  test('is not a reset route with no hash', () => {
    const { result } = renderHook(() => useResetPasswordToken());
    expect(result.current.isResetRoute).toBe(false);
    expect(result.current.token).toBeNull();
  });

  test('is not a reset route on an ordinary dashboard hash', () => {
    window.location.hash = '#/inventory';
    const { result } = renderHook(() => useResetPasswordToken());
    expect(result.current.isResetRoute).toBe(false);
  });

  test('reads the token out of the query string', () => {
    window.location.hash = '#/reset-password?token=abc123';
    const { result } = renderHook(() => useResetPasswordToken());
    expect(result.current.isResetRoute).toBe(true);
    expect(result.current.token).toBe('abc123');
  });

  test('a URL-encoded token is decoded', () => {
    window.location.hash = `#/reset-password?token=${encodeURIComponent('a+b/c=')}`;
    const { result } = renderHook(() => useResetPasswordToken());
    expect(result.current.token).toBe('a+b/c=');
  });

  test('is a reset route with a missing token, but the token is null', () => {
    // A link that lost its query string is still recognisably a reset
    // attempt — the UI should say "this link is broken", not "page not found".
    window.location.hash = '#/reset-password';
    const { result } = renderHook(() => useResetPasswordToken());
    expect(result.current.isResetRoute).toBe(true);
    expect(result.current.token).toBeNull();
  });

  test('a blank token is treated the same as a missing one', () => {
    window.location.hash = '#/reset-password?token=';
    const { result } = renderHook(() => useResetPasswordToken());
    expect(result.current.isResetRoute).toBe(true);
    expect(result.current.token).toBeNull();
  });

  test('updates live when the hash changes', () => {
    const { result } = renderHook(() => useResetPasswordToken());
    expect(result.current.isResetRoute).toBe(false);

    act(() => {
      window.location.hash = '#/reset-password?token=xyz';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current.isResetRoute).toBe(true);
    expect(result.current.token).toBe('xyz');
  });

  test('clear() leaves a plain hash behind', () => {
    window.location.hash = '#/reset-password?token=abc123';
    const { result } = renderHook(() => useResetPasswordToken());

    act(() => result.current.clear());

    expect(window.location.hash).toBe('#/');
  });

  test('clear() updates the hook state directly, without waiting on hashchange', () => {
    // The regression this pins: history.replaceState (what clear() uses so
    // it doesn't push a back-button entry back to a spent link) never fires
    // hashchange. A clear() that only changed the URL would leave
    // isResetRoute stuck at true — the address bar says login, the screen
    // stays on ResetPassword.
    window.location.hash = '#/reset-password?token=abc123';
    const { result } = renderHook(() => useResetPasswordToken());
    expect(result.current.isResetRoute).toBe(true);

    act(() => result.current.clear());

    expect(result.current.isResetRoute).toBe(false);
    expect(result.current.token).toBeNull();
  });
});
