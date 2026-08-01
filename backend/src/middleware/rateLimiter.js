import rateLimit, { MemoryStore } from 'express-rate-limit';

// express-rate-limit v7's default key is req.ip. Prefer the authenticated
// user id so household members behind one NAT'd home connection each get
// their own budget instead of sharing (and exhausting) a single IP bucket.
const userOrIpKey = (req) => req.user?.userId || req.ip;

// Stores are held explicitly rather than left implicit so the test suite can
// clear them between cases. That keeps every limiter genuinely active during
// tests — the alternative, disabling them under NODE_ENV=test, would mean
// the limits themselves were never exercised.
const stores = [];

function makeLimiter(options) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({ ...options, store, standardHeaders: true, legacyHeaders: false });
}

/** Clears every limiter's counters. Test-only. */
export function resetRateLimiters() {
  stores.forEach((store) => store.resetAll?.());
}

// Applies to POST /api/auth/login. Keyed by IP, so it won't lock out other
// users behind the same NAT/proxy indefinitely — it just slows brute force.
export const loginLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10, // 10 attempts per window per IP
    message: { error: 'Too many login attempts. Please try again in a few minutes.' },
    // Don't count successful logins against the window — only failed/aborted
    // attempts should burn the budget.
    skipSuccessfulRequests: true,
});

// Applies to POST /api/auth/register. Slightly looser since sign-ups are a
// one-time action per user, but still capped to blunt automated account
// creation / email enumeration.
export const registerLimiter = makeLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 20, // 20 registrations per window per IP
    message: { error: 'Too many accounts created from this network. Please try again later.' },
});

// Baseline limit for every other API route. Auth was previously the only
// rate-limited surface, which left every authenticated endpoint — including
// the ML proxy and the write paths — open to unbounded hammering by anyone
// holding a valid token.
//
// Keyed by user id when authenticated so household members sharing a home IP
// each get their own budget, falling back to IP for unauthenticated hits.
// The ceiling is high enough that normal dashboard use (which fans out into
// several requests per page) never touches it.
export const apiLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 600,
    keyGenerator: userOrIpKey,
    message: { error: 'Too many requests. Please slow down and try again shortly.' },
});

// Tighter budget for the endpoints that cost real work downstream: the ML
// proxy (which fans out to the Python service) and bulk import (which can
// write many documents per call).
export const expensiveLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    keyGenerator: userOrIpKey,
    message: { error: 'Too many requests for this operation. Please try again in a few minutes.' },
});

/**
 * Applies to the password-reset endpoints.
 *
 * Tighter than login: /forgot-password sends real email, so an unthrottled
 * caller could use it to spam a third party's inbox, and /reset-password is
 * the one place a token could be brute-forced.
 */
export const passwordResetLimiter = makeLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 10,
    message: { error: 'Too many password reset attempts. Please try again later.' },
});
