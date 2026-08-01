import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { findDevUserById, isDevModeId } from '../store/devStore.js';

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    // Fail loudly instead of silently signing/verifying tokens with a
    // secret that's checked into source control.
    throw new Error('JWT_SECRET must be set in production');
  }
  return 'dev-secret';
}

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

export const TOKEN_TTL = '7d';

/**
 * Signs the session token. `tv` pins the token to the user's current
 * token_version so it can be revoked server-side (see authenticateToken).
 */
export function signToken({ userId, email, role, householdId, tokenVersion = 0 }) {
  return jwt.sign(
    { userId, email, role, householdId, tv: tokenVersion },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

/**
 * Verifies the token, then re-reads the account behind it on every request.
 *
 * The signature alone is not enough: `role` and `is_active` live in the
 * database and can change at any moment, but a JWT is a 7-day-old snapshot.
 * Trusting the snapshot meant a member who was demoted, deactivated, or
 * removed kept their original access for up to a week. So this:
 *
 *   1. rejects tokens whose `tv` is behind the account's token_version
 *      (bumped on any role/status/password change — see teamController),
 *   2. rejects deactivated accounts,
 *   3. populates req.user.role from the *database*, not the token, so
 *      authorizeRoles below always gates on the live role.
 *
 * The cost is one lean, indexed lookup per authenticated request. At this
 * app's scale (a household's worth of traffic) that is the right trade for
 * correct revocation.
 */
export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    // A session opened while the DB was down carries a synthetic id that is
    // not a valid ObjectId. Once the DB is back, that session can't be
    // resolved to a real account — ask for a fresh login rather than letting
    // a CastError surface as an opaque 500 deeper in a controller.
    if (isDbConnected() && (isDevModeId(decoded.userId) || isDevModeId(decoded.householdId))) {
      return res.status(401).json({
        error: 'Your session was created while offline. Please log in again.',
      });
    }

    if (!isDbConnected()) {
      const devUser = findDevUserById(decoded.userId);
      if (!devUser) {
        return res.status(401).json({ error: 'Account no longer exists' });
      }
      if (devUser.is_active === false) {
        return res.status(403).json({ error: 'This account has been deactivated' });
      }
      if ((devUser.token_version || 0) !== (decoded.tv || 0)) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
      req.user = {
        userId: devUser.id,
        email: devUser.email,
        // Carried for the audit log, which denormalises the actor so an
        // entry still reads correctly after that member is removed.
        name: devUser.name || null,
        role: devUser.role || 'Admin',
        householdId: devUser.household_id || devUser.id,
      };
      return next();
    }

    const user = await User.findById(decoded.userId)
      .select('email name role is_active household_id token_version')
      .lean();

    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    if (user.is_active === false) {
      return res.status(403).json({ error: 'This account has been deactivated' });
    }
    if ((user.token_version || 0) !== (decoded.tv || 0)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    req.user = {
      userId: user._id.toString(),
      email: user.email,
      // Carried for the audit log, which denormalises the actor so an entry
      // still reads correctly after that member is removed.
      name: user.name || null,
      role: user.role || 'Admin',
      householdId: (user.household_id || user._id).toString(),
    };
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Failed to authenticate request' });
  }
};

export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Unauthorized: No role specified' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: Access restricted to: ${allowedRoles.join(', ')}` });
    }
    next();
  };
};

export { getJwtSecret };
