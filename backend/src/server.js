import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import actionPlanRoutes from './routes/actionPlanRoutes.js';
import { apiLimiter } from './middleware/rateLimiter.js';

dotenv.config();

export const app = express();
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

// Baseline security headers: nosniff, frameguard, HSTS, referrer policy,
// cross-origin isolation defaults. contentSecurityPolicy is disabled because
// this process only ever serves JSON — a CSP governs document rendering and
// would just be dead weight here (the SPA is served separately, and its own
// CSP belongs with whatever hosts frontend/dist).
app.use(helmet({ contentSecurityPolicy: false }));

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
// Bulk import legitimately posts a whole spreadsheet's worth of rows, so it
// gets a larger ceiling than the rest of the API's small JSON payloads.
app.use('/api/inventory/items/bulk', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));

// Health check is deliberately mounted before the limiter so uptime probes
// can poll it freely without eating into anyone's request budget.
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'HappyShelf API is running' });
});

app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/action-plans', actionPlanRoutes);

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

  // express.json() rejects oversized bodies with a 413 and malformed JSON
  // with a 400. Both are client errors and should say so rather than being
  // flattened into an opaque 500 by the fallback below.
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Only connect and listen when run directly. Importing this module (as the
// test suite does) gives you a configured app with no side effects — no
// open socket, no DB connection attempt.
if (process.env.NODE_ENV !== 'test') {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
