import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../services/api';

export interface UserSettings {
  profileName: string;
  emailNotifications: boolean;
}

const storageKey = (userId: string) => `hs:user:${userId}:settings`;

/**
 * Per-user settings.
 *
 * Both fields are authoritative on the server — `emailNotifications` drives
 * the real low/out-of-stock alert emails and `profileName` is the account
 * name — so they are always seeded from the signed-in user rather than from
 * localStorage, where a stale cached value could contradict what the backend
 * is actually doing. The per-user storage key is kept so any previously
 * cached blob is namespaced correctly and two accounts on one browser never
 * read each other's.
 *
 * (A "weekly summary" toggle used to live here. It persisted to localStorage
 * and nothing ever read it — there is no scheduler or backend field behind
 * it — so it has been removed rather than left as a control that silently
 * does nothing.)
 */
export function useUserSettings(user: AuthUser | null) {
  const [settings, setSettings] = useState<UserSettings>({
    profileName: user?.name || '',
    emailNotifications: user?.emailNotifications ?? true,
  });

  // Guards the very first write after a user loads, so hydrating from the
  // server doesn't immediately write the same value straight back.
  const skipNextSave = useRef(true);

  useEffect(() => {
    if (!user) return;

    skipNextSave.current = true;
    setSettings({
      profileName: user.name,
      emailNotifications: user.emailNotifications ?? true,
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }

    try {
      // A local echo of the last-seen values. The server stays the source of
      // truth on every load; this only avoids a blank form on a slow network.
      localStorage.setItem(storageKey(user.id), JSON.stringify(settings));
    } catch {
      // Storage can be full or blocked; losing a local echo is harmless.
    }
  }, [settings, user]);

  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  return { settings, setSettings, updateSettings };
}
