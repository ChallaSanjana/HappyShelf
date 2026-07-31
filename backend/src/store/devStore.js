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
