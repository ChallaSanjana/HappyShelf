import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';

// Simple in-memory dev fallback so registration/login work without Supabase
// when placeholder credentials are used. This keeps local dev smooth.
const isDevFallback = () => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  return url.includes('example') || key.includes('example');
};

const devUsers = new Map();
let nextDevId = 1;

export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (isDevFallback()) {
      // dev fallback: in-memory user store
      if (devUsers.has(email)) {
        return res.status(400).json({ error: 'Email already registered (dev)' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const id = nextDevId++;
      const user = { id, email, name, password_hash: passwordHash };
      devUsers.set(email, user);

      const token = jwt.sign({ userId: id, email }, process.env.JWT_SECRET || 'dev-secret', {
        expiresIn: '7d',
      });

      return res.status(201).json({
        message: 'User registered successfully (dev)',
        token,
        user: { id, email, name },
      });
    }

    // production / real supabase flow
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{ email, password_hash: passwordHash, name }])
      .select('id, email, name')
      .single();

    if (error) {
      throw error;
    }

    const token = jwt.sign({ userId: newUser.id, email: newUser.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: newUser.id, email: newUser.email, name: newUser.name },
    });
  } catch (error) {
    console.error('Register error:', error);
    // If supabase network/fetch failed, return a 502 with details in dev
    if (error && error.message && error.message.toLowerCase().includes('fetch failed')) {
      return res.status(502).json({ error: 'Upstream service unavailable', details: error.message });
    }

    res.status(500).json({ error: 'Failed to register user' });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }


    if (isDevFallback()) {
      const user = devUsers.get(email);
      if (!user) return res.status(401).json({ error: 'Invalid email or password (dev)' });
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) return res.status(401).json({ error: 'Invalid email or password (dev)' });

      const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET || 'dev-secret', {
        expiresIn: '7d',
      });

      return res.json({ message: 'Login successful (dev)', token, user: { id: user.id, email: user.email, name: user.name } });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, password_hash')
      .eq('email', email)
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
};
