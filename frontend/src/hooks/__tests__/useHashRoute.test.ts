import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHashRoute, DEFAULT_VIEW, VIEWS } from '../useHashRoute';

describe('useHashRoute', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  test('defaults to the dashboard with no hash', () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toBe(DEFAULT_VIEW);
  });

  test('reads the initial view from the URL, so links are deep-linkable', () => {
    window.location.hash = '#/inventory';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toBe('inventory');
  });

  test('accepts a hash without the leading slash', () => {
    window.location.hash = '#team';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toBe('team');
  });

  test('falls back to the dashboard for an unknown view', () => {
    // A stale bookmark or a typo should land somewhere, not render nothing.
    window.location.hash = '#/not-a-real-view';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current[0]).toBe(DEFAULT_VIEW);
  });

  test('navigating updates both the view and the URL', () => {
    const { result } = renderHook(() => useHashRoute());

    act(() => result.current[1]('stats'));

    expect(window.location.hash).toBe('#/stats');
    expect(result.current[0]).toBe('stats');
  });

  test('responds to browser back/forward', () => {
    // The whole point: previously the back button left the app entirely,
    // because the view was plain component state.
    const { result } = renderHook(() => useHashRoute());

    act(() => result.current[1]('predictions'));
    expect(result.current[0]).toBe('predictions');

    act(() => {
      window.location.hash = '#/dashboard';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current[0]).toBe('dashboard');
  });

  test('every declared view round-trips', () => {
    for (const view of VIEWS) {
      const { result } = renderHook(() => useHashRoute());
      act(() => result.current[1](view));
      expect(result.current[0]).toBe(view);
    }
  });
});
