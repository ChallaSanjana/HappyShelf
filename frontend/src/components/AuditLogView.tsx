import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ScrollText, Loader2 } from 'lucide-react';
import { auditLogApi, AuditLogEntry } from '../services/api';
import { LoadError } from './LoadError';

/**
 * Human labels for every action AUDIT_ACTIONS defines on the backend.
 *
 * Falls back to a generated label for anything not listed here, so a future
 * action added server-side renders as readable text instead of a raw
 * "member.role_changed"-style code or a crash.
 */
const ACTION_LABELS: Record<string, string> = {
  'item.created': 'Item added',
  'item.updated': 'Item edited',
  'item.deleted': 'Item deleted',
  'item.consumed': 'Item consumed',
  'item.reordered': 'Item reordered',
  'items.imported': 'Items imported',
  'member.added': 'Member added',
  'member.role_changed': 'Role changed',
  'member.deactivated': 'Member deactivated',
  'member.reactivated': 'Member reactivated',
  'member.removed': 'Member removed',
  'member.password_reset': "Member's password changed",
  'account.registered': 'Household registered',
  'account.profile_updated': 'Profile updated',
  'account.password_reset_requested': 'Password reset requested',
  'account.password_reset_completed': 'Password reset completed',
};

function labelFor(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // "member.some_new_action" -> "Member some new action"
  const [, rest] = action.split('.', 2);
  const words = (rest || action).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A compact "key: value, key: value" summary of the action-specific details. */
function formatDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '—';
  return entries
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') || 'none' : String(value)}`)
    .join(', ');
}

function actorLabel(entry: AuditLogEntry): string {
  return entry.actorName || entry.actorEmail || 'System';
}

function targetLabel(entry: AuditLogEntry): string {
  return entry.targetName || entry.targetId || `(${entry.targetType})`;
}

const LIMIT = 20;

/**
 * Read-only audit trail. Admin-only, enforced both by the sidebar (which
 * hides this route from anyone else) and the backend route itself — the
 * sidebar check is a UX nicety, not the actual boundary.
 */
export const AuditLogView = () => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const result = await auditLogApi.getAuditLog({
        page,
        limit: LIMIT,
        action: actionFilter || undefined,
      });
      setEntries(result.entries);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the audit log');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, actionFilter]);

  const knownActions = Object.keys(ACTION_LABELS);

  return (
    <div className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-6 bg-white rounded-t-xl border border-b-0 border-gray-200">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-gray-500" />
            Audit Log
          </h2>
          <div className="text-sm text-gray-500">Who did what, and when — read-only</div>
        </div>

        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {knownActions.map((action) => (
            <option key={action} value={action}>
              {ACTION_LABELS[action]}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-b-xl shadow-sm border border-t-0 border-gray-200">
        {error && (
          <div className="p-6 pb-0">
            <LoadError what="the audit log" detail={error} onRetry={load} isRetrying={isLoading} />
          </div>
        )}

        {isLoading && entries.length === 0 && !error ? (
          <div className="flex items-center justify-center gap-2 text-gray-500 py-16">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        ) : !error && entries.length === 0 ? (
          <div className="text-center text-gray-500 py-16">No audit log entries yet.</div>
        ) : !error ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Actor</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Action</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Target</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-800">{actorLabel(entry)}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm">
                      <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-700">
                        {labelFor(entry.action)}
                      </span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-800">{targetLabel(entry)}</td>
                    <td className="px-6 py-3 text-sm text-gray-500 max-w-md truncate" title={formatDetails(entry.details)}>
                      {formatDetails(entry.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!error && entries.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 text-sm text-gray-600">
            <div>
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total} entr{total !== 1 ? 'ies' : 'y'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </button>
              <span className="px-2">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogView;
