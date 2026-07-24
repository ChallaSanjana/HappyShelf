import rateLimit from 'express-rate-limit';

// Applies to POST /api/auth/login. Keyed by IP, so it won't lock out other
// users behind the same NAT/proxy indefinitely — it just slows brute force.
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10, // 10 attempts per window per IP
    standardHeaders: true, // return RateLimit-* headers
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in a few minutes.' },
    // Don't count successful logins against the window — only failed/aborted
    // attempts should burn the budget.
    skipSuccessfulRequests: true,
});

// Applies to POST /api/auth/register. Slightly looser since sign-ups are a
// one-time action per user, but still capped to blunt automated account
// creation / email enumeration.
export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 20, // 20 registrations per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many accounts created from this network. Please try again later.' },
});