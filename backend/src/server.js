import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';

dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

// Without this, express-rate-limit keys every request by the *proxy's* IP
// once this app runs behind a reverse proxy / load balancer (Heroku, nginx,
// most PaaS setups), so all users share one rate-limit bucket — and newer
// versions of express-rate-limit will throw at startup/request time because
// they detect an untrusted X-Forwarded-For header. `1` trusts exactly one
// hop (the immediate proxy), which is the right default for most deploys;
// adjust if you sit behind more than one proxy layer.
if (process.env.TRUST_PROXY !== 'false') {
  app.set('trust proxy', 1);
}

// cors() with no options reflects any Origin and allows it — fine for local
// dev, but on a deployed API it lets any website make authenticated,
// credentialed requests on a logged-in user's behalf. Restrict to an
// explicit allowlist from CORS_ORIGIN (comma-separated), falling back to
// localhost dev origins when it isn't set.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Allow non-browser requests (curl, server-to-server, health checks)
    // which don't send an Origin header at all.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Unbounded request bodies let a client send an arbitrarily large payload
// and tie up memory/CPU before any of the route-level validation runs.
// 100kb is generous for this API's JSON payloads (auth + item CRUD).
app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'HappyShelf API is running' });
});

// 404 for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Catch-all error handler — without this, any error thrown outside a
// try/catch in a route handler (e.g. malformed JSON body from express.json())
// would crash the process or hang the request instead of returning JSON.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});