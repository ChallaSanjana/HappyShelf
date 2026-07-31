import { useCallback, useEffect, useState } from 'react';

/**
 * The set of top-level views. Kept here rather than as a bare string so an
 * unknown hash (a typo, a stale bookmark) falls back to the dashboard
 * instead of rendering nothing.
 */
// Must stay in step with NAV_ITEMS in components/Sidebar.tsx — the sidebar
// is what pushes these keys, and an unlisted key would silently bounce the
// user back to the dashboard.
export const VIEWS = [
  'dashboard',
  'inventory',
  'alerts',
  'stats',
  'predictions',
  'sustainability',
  'team',
  'settings',
] as const;

export type View = (typeof VIEWS)[number];

export const DEFAULT_VIEW: View = 'dashboard';

function parseHash(): View {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return (VIEWS as readonly string[]).includes(raw) ? (raw as View) : DEFAULT_VIEW;
}

/**
 * Syncs the active view with the URL hash.
 *
 * The view used to be plain component state, which meant no view except the
 * dashboard could be linked to or bookmarked, the browser's back button
 * skipped straight out of the app, and a refresh always dumped you back on
 * the dashboard regardless of where you were.
 *
 * A hash route rather than the History API deliberately: it needs no
 * server-side rewrite rules, so `frontend/dist` still deploys to any static
 * host as-is.
 */
export function useHashRoute(): [View, (next: View) => void] {
  const [view, setView] = useState<View>(parseHash);

  useEffect(() => {
    const onHashChange = () => setView(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Normalise an empty or unrecognised hash so the URL always reflects what
  // is actually on screen. `replace` keeps it out of the back history.
  useEffect(() => {
    const current = window.location.hash.replace(/^#\/?/, '').trim();
    if (current !== view) {
      window.history.replaceState(null, '', `#/${view}`);
    }
    // Only on mount: afterwards navigate() owns the hash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((next: View) => {
    // Assigning the hash pushes a history entry, which is what makes the
    // back button walk back through the views the user actually visited.
    window.location.hash = `#/${next}`;
    // `hashchange` fires asynchronously, so relying on it alone would leave
    // the UI a tick behind every click. Setting state here makes navigation
    // immediate; the listener above still handles back/forward and any
    // hash edited directly in the address bar.
    setView(next);
  }, []);

  return [view, navigate];
}
