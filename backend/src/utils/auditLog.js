import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog.js';

/**
 * Recording an action must never be able to fail the action itself.
 *
 * Every call here is fire-and-forget and swallows its own errors: a full
 * disk or a slow write should not turn a successful consume into a 500. The
 * trade is deliberate — this is an operational record, not a ledger the
 * business depends on being complete.
 */

/** Every action the log knows how to record, so callers can't invent typos. */
export const AUDIT_ACTIONS = {
  ITEM_CREATED: 'item.created',
  ITEM_UPDATED: 'item.updated',
  ITEM_DELETED: 'item.deleted',
  ITEM_CONSUMED: 'item.consumed',
  ITEM_REORDERED: 'item.reordered',
  ITEMS_IMPORTED: 'items.imported',

  MEMBER_ADDED: 'member.added',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  MEMBER_DEACTIVATED: 'member.deactivated',
  MEMBER_REACTIVATED: 'member.reactivated',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_PASSWORD_RESET: 'member.password_reset',

  ACCOUNT_REGISTERED: 'account.registered',
  ACCOUNT_PROFILE_UPDATED: 'account.profile_updated',
  ACCOUNT_PASSWORD_RESET_REQUESTED: 'account.password_reset_requested',
  ACCOUNT_PASSWORD_RESET_COMPLETED: 'account.password_reset_completed',
};

const VALID_ACTIONS = new Set(Object.values(AUDIT_ACTIONS));

// In-memory mirror for the no-database mode, so the UI and the tests behave
// the same either way. Keyed by householdId, newest first.
const devAuditLog = new Map();
let nextDevAuditId = 1;
const DEV_LOG_CAP = 500;

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

/** Test-only: wipes the in-memory log between cases. */
export function clearDevAuditLog() {
  devAuditLog.clear();
}

export function getDevAuditLog(householdId) {
  if (!devAuditLog.has(householdId)) devAuditLog.set(householdId, []);
  return devAuditLog.get(householdId);
}

/**
 * Appends one entry.
 *
 * `actor` is the req.user of whoever performed the action; it may be null for
 * unauthenticated events such as a password reset completing via a token.
 */
export async function recordAudit({
  householdId,
  actor,
  action,
  targetType,
  targetId = null,
  targetName = null,
  details = {},
}) {
  try {
    if (!householdId || !action || !targetType) return;
    if (!VALID_ACTIONS.has(action)) {
      console.warn(`Refusing to record unknown audit action: ${action}`);
      return;
    }

    const entry = {
      household_id: householdId,
      actor_id: actor?.userId ?? null,
      actor_name: actor?.name ?? null,
      actor_email: actor?.email ?? null,
      action,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      target_name: targetName,
      details,
    };

    if (!isDbConnected()) {
      const log = getDevAuditLog(householdId);
      log.unshift({
        id: `dev_audit_${nextDevAuditId++}`,
        householdId,
        actorId: entry.actor_id,
        actorName: entry.actor_name,
        actorEmail: entry.actor_email,
        action,
        targetType,
        targetId: entry.target_id,
        targetName,
        details,
        createdAt: new Date().toISOString(),
      });
      // Unbounded growth in a long-lived dev process is a slow leak; the
      // database path has no such cap because it is queried with a limit.
      if (log.length > DEV_LOG_CAP) log.length = DEV_LOG_CAP;
      return;
    }

    // Dev-mode ids ("dev_1") are not ObjectIds and would throw on cast.
    if (typeof entry.actor_id === 'string' && !mongoose.Types.ObjectId.isValid(entry.actor_id)) {
      entry.actor_id = null;
    }

    await AuditLog.create(entry);
  } catch (error) {
    console.error('Failed to record audit entry:', error.message);
  }
}
