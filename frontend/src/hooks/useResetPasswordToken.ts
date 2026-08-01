import { useCallback, useEffect, useState } from 'react';

/**
 * Whether the URL currently points at a password-reset link
 * (`#/reset-password?token=...`), and the token it carries if so.
 *
 * Deliberately outside the `View` union in useHashRoute: this route has to
 * render before login (and even while a *different* session is active on
 * this browser — the token authorises the change on its own), so it can't
 * live inside the authenticated Dashboard's view switch the way every other
 * route does.
 */
interface ResetPasswordRoute {
  isResetRoute: boolean;
  /** Present only when isResetRoute is true; null means the link's token is missing or blank. */
  token: string | null;
}

function parseResetRoute(): ResetPasswordRoute {
  const hash = window.location.hash;
  const match = hash.match(/^#\/reset-password(?:\?(.*))?$/);
  if (!match) return { isResetRoute: false, token: null };

  const params = new URLSearchParams(match[1] || '');
  const token = params.get('token');
  return { isResetRoute: true, token: token && token.trim() ? token : null };
}

export interface ResetPasswordRouteState extends ResetPasswordRoute {
  /**
   * Leaves the reset-password route. Without this, clicking through to sign
   * in would still leave `#/reset-password?token=...` in the address bar, so
   * reloading the page would show the reset screen again instead of login.
   */
  clear: () => void;
}

export function useResetPasswordToken(): ResetPasswordRouteState {
  const [route, setRoute] = useState<ResetPasswordRoute>(parseResetRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(parseResetRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const clear = useCallback(() => {
    // history.replaceState deliberately, not location.hash: this must not
    // push a back-button entry that returns to a spent reset link.
    //
    // It also never fires `hashchange` (only real navigation and
    // pushState/assigning location.hash do), so relying on the listener
    // above alone left this hook's state stuck on isResetRoute: true after
    // the URL had already changed — the "Go to sign in" button updated the
    // address bar but the screen never actually left ResetPassword. Setting
    // state here directly, the same way useHashRoute's navigate() does for
    // exactly the same reason, is what makes the two consistent immediately.
    window.history.replaceState(null, '', '#/');
    setRoute({ isResetRoute: false, token: null });
  }, []);

  return { ...route, clear };
}
