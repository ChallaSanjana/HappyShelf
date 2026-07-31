import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { AuthProvider } from '../../contexts/AuthContext';
import { useHashRoute } from '../../hooks/useHashRoute';

/**
 * Wires the sidebar to the router exactly as Dashboard does, and shows the
 * resulting view so a test can assert on it.
 */
const Harness = () => {
  const [view, navigate] = useHashRoute();
  return (
    <AuthProvider>
      <div data-testid="current-view">{view}</div>
      <Sidebar onNavigate={navigate} activeKey={view} />
    </AuthProvider>
  );
};

const currentView = () => screen.getByTestId('current-view').textContent;

/**
 * Lets any queued hashchange event run.
 *
 * This is the crux of the regression: setting location.hash fires
 * `hashchange` asynchronously. The sidebar used to follow up with
 * `history.pushState(..., '/inventory')`, which stripped the hash it had just
 * set — so when the queued hashchange finally ran, it read an empty hash and
 * reset the view to the dashboard. Everything looked fine until the event
 * loop turned.
 */
const flushHashChange = async () => {
  await act(async () => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await Promise.resolve();
  });
};

describe('sidebar navigation', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  test('starts on the dashboard', () => {
    render(<Harness />);
    expect(currentView()).toBe('dashboard');
  });

  test('clicking a nav item changes the view', () => {
    render(<Harness />);
    act(() => {
      screen.getByRole('menuitem', { name: /Inventory/i }).click();
    });
    expect(currentView()).toBe('inventory');
  });

  test('the view SURVIVES the queued hashchange', async () => {
    // The actual regression. Before the fix this reverted to 'dashboard'.
    render(<Harness />);
    act(() => {
      screen.getByRole('menuitem', { name: /Inventory/i }).click();
    });
    await flushHashChange();
    expect(currentView()).toBe('inventory');
  });

  test('the URL keeps the hash route after a click', async () => {
    render(<Harness />);
    act(() => {
      screen.getByRole('menuitem', { name: /Statistics/i }).click();
    });
    await flushHashChange();
    expect(window.location.hash).toBe('#/stats');
  });

  test('the URL path is not rewritten', async () => {
    // pushState('/stats') would break a refresh on any static host without
    // SPA rewrite rules — the reason this app routes on the hash.
    const pathBefore = window.location.pathname;
    render(<Harness />);
    act(() => {
      screen.getByRole('menuitem', { name: /Statistics/i }).click();
    });
    await flushHashChange();
    expect(window.location.pathname).toBe(pathBefore);
  });

  test('navigating twice lands on the second view', async () => {
    render(<Harness />);
    act(() => {
      screen.getByRole('menuitem', { name: /Inventory/i }).click();
    });
    await flushHashChange();
    act(() => {
      screen.getByRole('menuitem', { name: /Alerts/i }).click();
    });
    await flushHashChange();
    expect(currentView()).toBe('alerts');
  });

  test('nav items are real links pointing at their hash route', () => {
    render(<Harness />);
    const link = screen.getByRole('menuitem', { name: /Inventory/i });
    expect(link).toHaveAttribute('href', '#/inventory');
  });

  test('the active item is marked for assistive tech', async () => {
    render(<Harness />);
    act(() => {
      screen.getByRole('menuitem', { name: /Inventory/i }).click();
    });
    await flushHashChange();
    expect(screen.getByRole('menuitem', { name: /Inventory/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  test('a deep-linked hash renders that view on load', () => {
    window.location.hash = '#/predictions';
    render(<Harness />);
    expect(currentView()).toBe('predictions');
  });
});
