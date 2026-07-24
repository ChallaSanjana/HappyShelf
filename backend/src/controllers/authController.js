import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { getJwtSecret } from '../middleware/auth.js';

// In-memory storage fallback for development when MongoDB is unavailable
export const devUsers = new Map();
let nextUserId = 1;

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

      const userId = `dev_${nextUserId++}`;
      const user = { id: userId, email, name, password_hash: passwordHash, role: 'Admin', household_id: userId };
      devUsers.set(email, user);

      const token = jwt.sign(
        { userId, email, role: 'Admin', householdId: userId },
        getJwtSecret(),
        { expiresIn: '7d' }
      );

      console.log(`✓ User registered (in-memory): ${email}`);
      return res.status(201).json({
        message: 'User registered successfully (dev mode)',
        token,
        user: { id: userId, email, name, role: 'Admin', householdId: userId },
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
    const token = jwt.sign(
      { 
        userId: newUser._id.toString(), 
        email: newUser.email, 
        role: newUser.role || 'Admin', 
        householdId: (newUser.household_id || newUser._id).toString() 
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { 
        id: newUser._id.toString(), 
        email: newUser.email, 
        name: newUser.name, 
        role: newUser.role || 'Admin', 
        householdId: (newUser.household_id || newUser._id).toString() 
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

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role || 'Admin', householdId: user.household_id || user.id },
        getJwtSecret(),
        { expiresIn: '7d' }
      );

      console.log(`✓ User logged in (in-memory): ${email}`);
      return res.json({
        message: 'Login successful (dev mode)',
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role || 'Admin', householdId: user.household_id || user.id },
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

    const token = jwt.sign(
      { 
        userId: user._id.toString(), 
        email: user.email, 
        role: user.role || 'Admin', 
        householdId: (user.household_id || user._id).toString() 
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { 
        id: user._id.toString(), 
        email: user.email, 
        name: user.name, 
        role: user.role || 'Admin', 
        householdId: (user.household_id || user._id).toString() 
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
};