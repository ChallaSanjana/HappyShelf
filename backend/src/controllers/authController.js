import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import User from '../models/User.js';
import crypto from 'crypto';
import PasswordResetToken from '../models/PasswordResetToken.js';
import { signToken } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../utils/mailer.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import {
  devUsers,
  nextDevUserId,
  findDevUserById,
  createDevResetToken,
  findDevResetToken,
  consumeDevResetToken,
} from '../store/devStore.js';

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// Mongoose only applies schema setters (lowercase/trim) when a document is
// saved — NOT when it's used as a query filter. Without normalizing here,
// "Jane@Example.com" would be stored as "jane@example.com" but a later
// findOne({ email: 'Jane@Example.com' }) would fail to match it, causing
// valid users to get "Invalid email or password" on login. Normalizing here
// also keeps dev-mode (Map-keyed) and DB-mode behavior consistent.
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : email;
}

// req.body comes straight from express.json(), so `email`/`password` can be
// any JSON type an attacker chooses to send — not just a string. If an
// object like { "$gt": "" } or { "$ne": null } reaches a Mongoose query
// filter unchecked, Mongo query operators are NOT stringified away; they're
// passed straight through to the database. That turns User.findOne({ email })
// into a NoSQL injection vector (arbitrary-match / enumeration / always-true
// existence checks), even though bcrypt.compare would still block a full
// auth bypass on login. Rejecting non-string input here closes that off
// before it ever reaches a query.
function isValidCredentialInput(email, password, name) {
  if (typeof email !== 'string' || typeof password !== 'string') return false;
  if (name !== undefined && typeof name !== 'string') return false;
  return true;
}

// Applied only at registration — login must still accept whatever password
// length a user's existing account was created with, so this can't run
// there without locking out real users on old, shorter passwords.
const MIN_PASSWORD_LENGTH = 8;

function isStrongEnoughPassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasLetter && hasNumber;
}


export const register = async (req, res) => {
  try {
    const { password, name } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!isValidCredentialInput(email, password, name)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    if (!isStrongEnoughPassword(password)) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and include a letter and a number`,
      });
    }

    if (!isDbConnected()) {
      // Dev mode: in-memory user storage
      if (devUsers.has(email)) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      // Re-check after the (async) hash completes — two concurrent
      // registrations for the same email could otherwise both pass the
      // check above and the second write would silently clobber the first.
      if (devUsers.has(email)) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const userId = nextDevUserId();
      const user = { id: userId, email, name, password_hash: passwordHash, role: 'Admin', household_id: userId, email_notifications: true, is_active: true, token_version: 0 };
      devUsers.set(email, user);

      const token = signToken({ userId, email, role: 'Admin', householdId: userId, tokenVersion: 0 });

      console.log(`✓ User registered (in-memory): ${email}`);

      await recordAudit({
        householdId: userId,
        actor: { userId, name, email },
        action: AUDIT_ACTIONS.ACCOUNT_REGISTERED,
        targetType: 'account',
        targetId: userId,
        targetName: name,
        details: { email },
      });

      return res.status(201).json({
        message: 'User registered successfully (dev mode)',
        token,
        user: { id: userId, email, name, role: 'Admin', householdId: userId, emailNotifications: true },
      });
    }

    // MongoDB mode: check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create new user
    let newUser;
    try {
      newUser = await User.create({
        email,
        password_hash: passwordHash,
        name,
        role: 'Admin', // Default to Admin for main account registration
      });
    } catch (createError) {
      if (createError.code === 11000) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      throw createError;
    }

    // Generate JWT token
    const token = signToken({
      userId: newUser._id.toString(),
      email: newUser.email,
      role: newUser.role || 'Admin',
      householdId: (newUser.household_id || newUser._id).toString(),
      tokenVersion: newUser.token_version || 0,
    });

    await recordAudit({
      householdId: (newUser.household_id || newUser._id).toString(),
      actor: { userId: newUser._id.toString(), name: newUser.name, email: newUser.email },
      action: AUDIT_ACTIONS.ACCOUNT_REGISTERED,
      targetType: 'account',
      targetId: newUser._id.toString(),
      targetName: newUser.name,
      details: { email: newUser.email },
    });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: newUser._id.toString(),
        email: newUser.email,
        name: newUser.name,
        role: newUser.role || 'Admin',
        householdId: (newUser.household_id || newUser._id).toString(),
        emailNotifications: newUser.email_notifications !== false,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
};

export const login = async (req, res) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!isValidCredentialInput(email, password)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    if (!isDbConnected()) {
      const user = devUsers.get(email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Checked *after* the password so this can't be used to probe which
      // addresses belong to deactivated accounts.
      if (user.is_active === false) {
        return res.status(403).json({ error: 'This account has been deactivated. Contact an Admin on your team.' });
      }

      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role || 'Admin',
        householdId: user.household_id || user.id,
        tokenVersion: user.token_version || 0,
      });

      console.log(`✓ User logged in (in-memory): ${email}`);
      return res.json({
        message: 'Login successful (dev mode)',
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role || 'Admin', householdId: user.household_id || user.id, emailNotifications: user.email_notifications !== false },
      });
    }

    // Find user by email
    const user = await User.findOne({ email }).select('+password_hash');

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // A deactivated member must not be able to simply log in again. This was
    // previously unchecked, which made the whole deactivation feature in
    // teamController (and the last-Admin safeguard protecting it) cosmetic.
    // Checked *after* the password so this can't be used to probe which
    // addresses belong to deactivated accounts.
    if (user.is_active === false) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact an Admin on your team.' });
    }

    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role || 'Admin',
      householdId: (user.household_id || user._id).toString(),
      tokenVersion: user.token_version || 0,
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role || 'Admin',
        householdId: (user.household_id || user._id).toString(),
        emailNotifications: user.email_notifications !== false,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
};

function serializeDevUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'Admin',
    householdId: user.household_id || user.id,
    emailNotifications: user.email_notifications !== false,
  };
}

export const getMe = async (req, res) => {
  try {
    if (!isDbConnected()) {
      const user = findDevUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.json({ user: serializeDevUser(user) });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

export const updateMe = async (req, res) => {
  try {
    const { name, emailNotifications } = req.body;

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    if (emailNotifications !== undefined && typeof emailNotifications !== 'boolean') {
      return res.status(400).json({ error: 'emailNotifications must be a boolean' });
    }

    if (!isDbConnected()) {
      const user = findDevUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (name !== undefined) user.name = name.trim();
      if (emailNotifications !== undefined) user.email_notifications = emailNotifications;

      await recordAudit({
        householdId: user.household_id || user.id,
        actor: req.user,
        action: AUDIT_ACTIONS.ACCOUNT_PROFILE_UPDATED,
        targetType: 'account',
        targetId: user.id,
        targetName: user.name,
        details: { fields: Object.keys(req.body || {}) },
      });

      return res.json({ message: 'Profile updated successfully (dev mode)', user: serializeDevUser(user) });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (emailNotifications !== undefined) updateData.email_notifications = emailNotifications;

    const user = await User.findByIdAndUpdate(req.user.userId, updateData, { returnDocument: 'after' });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await recordAudit({
      householdId: (user.household_id || user._id).toString(),
      actor: req.user,
      action: AUDIT_ACTIONS.ACCOUNT_PROFILE_UPDATED,
      targetType: 'account',
      targetId: user._id.toString(),
      targetName: user.name,
      details: { fields: Object.keys(req.body || {}) },
    });

    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// --- Password reset --------------------------------------------------------

/** How long a reset link stays valid. Short on purpose. */
const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 30;

/**
 * Only the hash is ever stored, so a leaked database yields no usable links.
 * SHA-256 rather than bcrypt: the token is 32 bytes of CSPRNG output with no
 * guessable structure, and lookup must be one indexed query.
 */
function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * The one place a reset token's raw value is generated.
 *
 * Normally 32 bytes of CSPRNG output. Under NODE_ENV=test-e2e — the mode
 * playwright.config.ts runs the E2E backend under, and only that mode —
 * generation is deterministic instead, keyed by the account's email. E2E
 * exercises this over a real browser talking to a real, separately-spawned
 * backend process; the raw token exists nowhere the test can read it (it is
 * deliberately never logged or returned by any endpoint), so without this
 * the flow the emailed link enables would be entirely untestable end-to-end.
 *
 * This does not weaken "never store raw reset tokens": storage is completely
 * unchanged in every mode — only the hash is ever persisted. It changes
 * nothing about randomness in production, development, or the unit-test
 * harness (NODE_ENV=test, a different value), where this branch is dead code.
 */
function generateResetTokenBytes(email) {
  if (process.env.NODE_ENV === 'test-e2e') {
    return crypto.createHash('sha256').update(`e2e-fixed-reset-token:${email}`).digest();
  }
  return crypto.randomBytes(32);
}

/**
 * Starts a reset.
 *
 * Always answers 200 with the same body, whether or not the address belongs
 * to an account. Saying "no such user" would turn this endpoint into a free
 * membership oracle — worth more to an attacker than the reset itself.
 */
export const forgotPassword = async (req, res) => {
  const genericResponse = {
    message: 'If that email is registered, a reset link is on its way.',
  };

  try {
    const email = normalizeEmail(req.body.email);
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!isDbConnected()) {
      // Mirrors the DB path exactly — same hashing, same TTL, same
      // single-use enforcement — just backed by devStore's Map instead of a
      // collection. Dev mode losing this on restart is an accepted property
      // of dev mode generally (devUsers/devInventory do too), not a
      // relaxation made specifically for reset tokens.
      const user = devUsers.get(email);

      // A deactivated account must not be reachable via reset either — that
      // would be a way back in past the deactivation.
      if (user && user.is_active !== false) {
        const rawToken = generateResetTokenBytes(email).toString('hex');
        const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
        createDevResetToken(user.id, hashResetToken(rawToken), expiresAt);

        await sendPasswordResetEmail({ email: user.email, name: user.name }, rawToken);

        await recordAudit({
          householdId: user.household_id || user.id,
          actor: null,
          action: AUDIT_ACTIONS.ACCOUNT_PASSWORD_RESET_REQUESTED,
          targetType: 'account',
          targetId: user.id,
          targetName: user.name,
          details: { email: user.email },
        });
      }

      return res.json(genericResponse);
    }

    const user = await User.findOne({ email });

    // A deactivated account must not be reachable via reset either — that
    // would be a way back in past the deactivation.
    if (user && user.is_active !== false) {
      const rawToken = generateResetTokenBytes(email).toString('hex');

      await PasswordResetToken.create({
        user_id: user._id,
        token_hash: hashResetToken(rawToken),
        expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
      });

      await sendPasswordResetEmail({ email: user.email, name: user.name }, rawToken);

      await recordAudit({
        householdId: (user.household_id || user._id).toString(),
        actor: null,
        action: AUDIT_ACTIONS.ACCOUNT_PASSWORD_RESET_REQUESTED,
        targetType: 'account',
        targetId: user._id.toString(),
        targetName: user.name,
        details: { email: user.email },
      });
    }

    res.json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    // Still generic: an error here must not reveal whether the address exists.
    res.json(genericResponse);
  }
};

/**
 * Completes a reset.
 *
 * Single-use and time-limited, and it revokes every existing session for the
 * account — the usual reason to reset a password is that someone else may
 * have had it.
 */
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (typeof token !== 'string' || !token || typeof password !== 'string') {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (!isStrongEnoughPassword(password)) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and include a letter and a number`,
      });
    }

    // One message for every failure mode — expired, already spent, never
    // existed. Distinguishing them tells an attacker which guesses were close.
    const invalid = { error: 'This reset link is invalid or has expired. Request a new one.' };

    if (!isDbConnected()) {
      const tokenHash = hashResetToken(token);
      const record = findDevResetToken(tokenHash);

      if (!record) return res.status(400).json(invalid);
      if (record.usedAt !== null) return res.status(400).json(invalid);
      if (record.expiresAt <= Date.now()) return res.status(400).json(invalid);

      const user = findDevUserById(record.userId);
      if (!user || user.is_active === false) return res.status(400).json(invalid);

      // Marked spent before the password is written. If anything below
      // fails, the link is still burnt — the safer direction to fail in.
      consumeDevResetToken(tokenHash);

      user.password_hash = await bcrypt.hash(password, 10);
      // Every outstanding session for this account stops working.
      user.token_version = (user.token_version || 0) + 1;

      await recordAudit({
        householdId: user.household_id || user.id,
        actor: null,
        action: AUDIT_ACTIONS.ACCOUNT_PASSWORD_RESET_COMPLETED,
        targetType: 'account',
        targetId: user.id,
        targetName: user.name,
        details: { email: user.email },
      });

      return res.json({ message: 'Password updated. You can now sign in with your new password.' });
    }

    const record = await PasswordResetToken.findOne({ token_hash: hashResetToken(token) });

    if (!record) return res.status(400).json(invalid);
    if (record.used_at) return res.status(400).json(invalid);
    if (record.expires_at.getTime() <= Date.now()) return res.status(400).json(invalid);

    const user = await User.findById(record.user_id);
    if (!user || user.is_active === false) return res.status(400).json(invalid);

    // Marked spent before the password is written. If anything below fails,
    // the link is still burnt — the safer direction to fail in.
    record.used_at = new Date();
    await record.save();

    user.password_hash = await bcrypt.hash(password, 10);
    // Every outstanding session for this account stops working.
    user.token_version = (user.token_version || 0) + 1;
    await user.save();

    // Any other links issued before this one are now pointless.
    await PasswordResetToken.updateMany(
      { user_id: user._id, used_at: null },
      { $set: { used_at: new Date() } }
    );

    await recordAudit({
      householdId: (user.household_id || user._id).toString(),
      actor: null,
      action: AUDIT_ACTIONS.ACCOUNT_PASSWORD_RESET_COMPLETED,
      targetType: 'account',
      targetId: user._id.toString(),
      targetName: user.name,
      details: { email: user.email },
    });

    res.json({ message: 'Password updated. You can now sign in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};
