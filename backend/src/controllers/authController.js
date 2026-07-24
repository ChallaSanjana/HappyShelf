import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { getJwtSecret } from '../middleware/auth.js';

// In-memory storage fallback for development when MongoDB is unavailable
const devUsers = new Map();
let nextUserId = 1;

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (!isDbConnected()) {
      // Dev mode: in-memory user storage
      if (devUsers.has(email)) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const userId = `dev_${nextUserId++}`;
      const user = { id: userId, email, name, password_hash: passwordHash };
      devUsers.set(email, user);

      const token = jwt.sign(
        { userId, email },
        getJwtSecret(),
        { expiresIn: '7d' }
      );

      console.log(`✓ User registered (in-memory): ${email}`);
      return res.status(201).json({
        message: 'User registered successfully (dev mode)',
        token,
        user: { id: userId, email, name },
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
    const newUser = await User.create({
      email,
      password_hash: passwordHash,
      name,
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser._id.toString(), email: newUser.email },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: newUser._id.toString(), email: newUser.email, name: newUser.name },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
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
        { userId: user.id, email: user.email },
        getJwtSecret(),
        { expiresIn: '7d' }
      );

      console.log(`✓ User logged in (in-memory): ${email}`);
      return res.json({
        message: 'Login successful (dev mode)',
        token,
        user: { id: user.id, email: user.email, name: user.name },
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
      { userId: user._id.toString(), email: user.email },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id.toString(), email: user.email, name: user.name },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
};