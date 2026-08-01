// In-memory stores used only when MongoDB is unreachable AND the process is
// not running in production (see config/database.js, which now refuses to
// start without a DB in production).
//
// These live in their own module rather than inside authController so that
// middleware/auth.js can read devUsers without creating an import cycle —
// authController imports getJwtSecret from middleware/auth.js, so the reverse
// import would make the two modules mutually dependent.

/** email -> user record */
export const devUsers = new Map();

let nextUserId = 1;
export function nextDevUserId() {
  return `dev_${nextUserId++}`;
}

/** Look up a dev-mode user by their synthetic id. */
export function findDevUserById(userId) {
  return Array.from(devUsers.values()).find((u) => u.id === userId) || null;
}

/**
 * Synthetic ids issued while the DB was down ("dev_1") are not valid Mongo
 * ObjectIds. If the DB comes back up during such a token's 7-day lifetime,
 * any query built from it would throw a CastError, so callers reject the
 * session up front instead.
 */
export function isDevModeId(id) {
  return typeof id === 'string' && id.startsWith('dev_');
}

/**
 * In-memory mirror of PasswordResetToken, used when there is no database.
 *
 * Only ever holds the SHA-256 hash of a token, never the raw value — same
 * rule as the persisted model. Losing this Map on restart is an accepted
 * property of dev mode generally (devUsers/devInventory do too), not a
 * relaxation made specifically for reset tokens.
 *
 * tokenHash -> { userId, expiresAt: <ms epoch>, usedAt: <ms epoch> | null }
 */
const devPasswordResetTokens = new Map();

export function createDevResetToken(userId, tokenHash, expiresAt) {
  devPasswordResetTokens.set(tokenHash, { userId, expiresAt: expiresAt.getTime(), usedAt: null });
}

export function findDevResetToken(tokenHash) {
  return devPasswordResetTokens.get(tokenHash) || null;
}

/**
 * Marks one token spent and, mirroring the Mongo path, sweeps every other
 * still-live token for the same user — a second outstanding link becomes
 * pointless the moment one of them is used.
 */
export function consumeDevResetToken(tokenHash) {
  const spent = devPasswordResetTokens.get(tokenHash);
  if (!spent) return;

  const now = Date.now();
  for (const record of devPasswordResetTokens.values()) {
    if (record.userId === spent.userId && record.usedAt === null) {
      record.usedAt = now;
    }
  }
}

/** Test-only: wipes every outstanding reset token between test cases. */
export function clearDevPasswordResetTokens() {
  devPasswordResetTokens.clear();
}
