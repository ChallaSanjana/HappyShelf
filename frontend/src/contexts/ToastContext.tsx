import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** Optional detail lines, e.g. per-row import failures. */
  details?: string[];
}

interface ToastContextType {
  /** Shows a toast and returns its id, so a caller can dismiss it early. */
  showToast: (message: string, tone?: ToastTone, details?: string[]) => number;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

/** Errors stay up longer — they usually carry something worth reading. */
const DURATIONS: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  warning: 8000,
  error: 10000,
};

const TONE_STYLES: Record<ToastTone, { wrapper: string; icon: ReactNode }> = {
  success: {
    wrapper: 'bg-white border-green-200 text-green-900',
    icon: <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" aria-hidden="true" />,
  },
  error: {
    wrapper: 'bg-white border-red-200 text-red-900',
    icon: <XCircle className="w-5 h-5 text-red-600 shrink-0" aria-hidden="true" />,
  },
  warning: {
    wrapper: 'bg-white border-orange-200 text-orange-900',
    icon: <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0" aria-hidden="true" />,
  },
  info: {
    wrapper: 'bg-white border-blue-200 text-blue-900',
    icon: <Info className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" />,
  },
};

/**
 * Replaces the window.alert() calls the app used for every success, error and
 * validation message.
 *
 * alert() blocks the main thread, cannot be styled, drops any detail longer
 * than a line or two, and is invisible to assistive tech beyond the raw
 * string. This renders into an aria-live region instead, so screen readers
 * announce messages without stealing focus.
 */
export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info', details?: string[]) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, tone, details }]);
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), DURATIONS[tone])
      );
      return id;
    },
    [dismissToast]
  );

  // Clear any pending timers if the provider unmounts mid-countdown.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))]"
        // "polite" so a toast never interrupts whatever a screen reader is
        // already announcing; these are status updates, not alarms.
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => {
          const { wrapper, icon } = TONE_STYLES[toast.tone];
          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 rounded-lg border shadow-lg px-4 py-3 ${wrapper}`}
            >
              {icon}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium break-words">{toast.message}</p>
                {toast.details && toast.details.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs opacity-80 max-h-32 overflow-y-auto">
                    {toast.details.map((detail, index) => (
                      <li key={index} className="break-words">
                        {detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current"
                aria-label={`Dismiss: ${toast.message}`}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
