import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { signToken } from '../middleware/auth.js';
import { devUsers, nextDevUserId, findDevUserById } from '../store/devStore.js';

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
      return res.json({ message: 'Profile updated successfully (dev mode)', user: serializeDevUser(user) });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (emailNotifications !== undefined) updateData.email_notifications = emailNotifications;

    const user = await User.findByIdAndUpdate(req.user.userId, updateData, { new: true });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};