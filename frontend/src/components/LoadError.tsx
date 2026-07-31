import { AlertTriangle, RefreshCw } from 'lucide-react';

interface LoadErrorProps {
  /** What failed to load, e.g. "inventory" — used in the message. */
  what: string;
  /** The underlying error message, shown as detail when available. */
  detail?: string | null;
  onRetry: () => void;
  isRetrying?: boolean;
}

/**
 * Shown when a background fetch fails.
 *
 * These failures used to be swallowed into console.error, so a request that
 * failed for any reason other than an expired session (a network blip, a 500)
 * left the user looking at an empty dashboard — indistinguishable from having
 * no data at all, and with no way to recover short of reloading the page.
 */
export const LoadError = ({ what, detail, onRetry, isRetrying = false }: LoadErrorProps) => (
  <div
    role="alert"
    className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4"
  >
    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" aria-hidden="true" />
    <div className="flex-1">
      <p className="font-medium text-red-800">Could not load {what}.</p>
      {detail && <p className="mt-0.5 text-sm text-red-700">{detail}</p>}
    </div>
    <button
      onClick={onRetry}
      disabled={isRetrying}
      className="flex flex-shrink-0 items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} aria-hidden="true" />
      {isRetrying ? 'Retrying…' : 'Retry'}
    </button>
  </div>
);

export default LoadError;
