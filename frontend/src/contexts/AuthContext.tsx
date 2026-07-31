import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi, AuthUser } from '../services/api';
import { setUnauthorizedHandler } from '../services/httpClient';

type User = AuthUser;

interface AuthContextType {
  user: User | null;
  token: string | null;
  /** Set when the session ended on its own (expired, revoked, deactivated). */
  sessionMessage: string | null;
  clearSessionMessage: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  updateProfile: (updates: { name?: string; emailNotifications?: boolean }) => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSessionMessage(null);
  }, [clearSession]);

  /**
   * Any API call that comes back 401 (or a "deactivated" 403) ends the
   * session here. Previously nothing handled these at all: an expired token
   * left every screen stuck on "Failed to fetch items" with no route back
   * except clearing localStorage by hand.
   */
  useEffect(() => {
    setUnauthorizedHandler((reason) => {
      clearSession();
      setSessionMessage(reason || 'Your session has ended. Please log in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  /**
   * Restore the cached session, then confirm it against the server.
   *
   * The cached `user` blob is only a hint: role and account status live in
   * the database and may have changed since it was written. Trusting it
   * meant the UI could gate permissions on a role that was days stale — and
   * now that the backend revokes tokens on demotion, that cached role could
   * even outlive the session itself. The UI renders immediately from cache
   * so there is no login flash, and corrects itself once /auth/me answers.
   */
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    setToken(storedToken);
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem(USER_KEY);
      }
    }

    let cancelled = false;
    authApi
      .getMe()
      .then((freshUser) => {
        if (cancelled) return;
        setUser(freshUser);
        localStorage.setItem(USER_KEY, JSON.stringify(freshUser));
      })
      .catch(() => {
        // A 401/403 has already been handled by the unauthorized handler
        // above. Anything else (server down, network blip) leaves the cached
        // session in place rather than logging the user out over a hiccup.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const persistSession = useCallback((nextToken: string, nextUser: User) => {
    setToken(nextToken);
    setUser(nextUser);
    setSessionMessage(null);
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await authApi.login(email, password);
      persistSession(data.token, data.user);
    },
    [persistSession]
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const data = await authApi.register(email, password, name);
      persistSession(data.token, data.user);
    },
    [persistSession]
  );

  const updateProfile = useCallback(
    async (updates: { name?: string; emailNotifications?: boolean }) => {
      const updated = await authApi.updateMe(updates);
      setUser(updated);
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        sessionMessage,
        clearSessionMessage: () => setSessionMessage(null),
        login,
        register,
        logout,
        updateProfile,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
