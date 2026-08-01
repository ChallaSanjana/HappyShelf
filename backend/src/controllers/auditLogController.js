import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog.js';
import { getDevAuditLog } from '../utils/auditLog.js';

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The household's audit trail, newest first.
 *
 * Read-only by design — there is no endpoint to edit or delete an entry. An
 * audit log the audited party can rewrite is worse than none, because it
 * looks trustworthy.
 *
 * Admin-only, enforced at the route. Managers can act on team members but
 * cannot review who else did what.
 */
export const getAuditLog = async (req, res) => {
  try {
    const householdId = req.user.householdId;

    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(MAX_LIMIT, Math.max(1, parsedLimit))
      : DEFAULT_LIMIT;

    const parsedPage = parseInt(req.query.page, 10);
    const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;

    const { action, targetType } = req.query;

    if (!isDbConnected()) {
      let entries = getDevAuditLog(householdId);
      if (action) entries = entries.filter((e) => e.action === action);
      if (targetType) entries = entries.filter((e) => e.targetType === targetType);

      const total = entries.length;
      const start = (page - 1) * limit;
      return res.json({
        entries: entries.slice(start, start + limit),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    }

    const filter = { household_id: householdId };
    if (action) filter.action = action;
    if (targetType) filter.target_type = targetType;

    const [entries, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      entries,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
};
