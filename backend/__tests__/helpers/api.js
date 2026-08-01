import request from 'supertest';
import { devUsers, clearDevPasswordResetTokens } from '../../src/store/devStore.js';
import { devInventory } from '../../src/controllers/inventoryController.js';
import { resetRateLimiters } from '../../src/middleware/rateLimiter.js';
import { clearDevAuditLog } from '../../src/utils/auditLog.js';

/**
 * Test harness for the HTTP API.
 *
 * With NODE_ENV=test the app never connects to Mongo, so isDbConnected() is
 * false everywhere and the in-memory store backs every request. That makes
 * the whole API exercisable end-to-end — auth, RBAC, the last-Admin
 * safeguard, stock invariants — with no database to stand up.
 *
 * The Mongo-specific paths ($inc atomicity, insertMany ordering) can't be
 * meaningfully asserted without a real server and are covered by the
 * validation/metric unit tests instead.
 */

let app;

export async function getApp() {
  if (!app) {
    ({ app } = await import('../../src/server.js'));
  }
  return app;
}

/**
 * Wipes all in-memory state so each test starts from an empty household,
 * including the rate-limit counters — otherwise a suite that registers more
 * than 20 accounts would start 429ing partway through.
 */
export function resetStores() {
  devUsers.clear();
  devInventory.clear();
  clearDevAuditLog();
  clearDevPasswordResetTokens();
  resetRateLimiters();
}

/** Registers a household Admin and returns { token, user, agent }. */
export async function registerAdmin(overrides = {}) {
  const server = await getApp();
  const payload = {
    name: 'Test Admin',
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'password123',
    ...overrides,
  };

  const res = await request(server).post('/api/auth/register').send(payload);
  if (res.status !== 201) {
    throw new Error(`registerAdmin failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, user: res.body.user, password: payload.password };
}

/** Adds a team member in the given role, acting as `token`. */
export async function addMember(token, role, overrides = {}) {
  const server = await getApp();
  const payload = {
    name: `Test ${role}`,
    email: `${role.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'password123',
    role,
    ...overrides,
  };

  const res = await request(server).post('/api/team').set('Authorization', `Bearer ${token}`).send(payload);
  if (res.status !== 201) {
    throw new Error(`addMember(${role}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { member: res.body.member, password: payload.password, email: payload.email };
}

/** Logs in and returns the raw response, so tests can assert on failures too. */
export async function login(email, password) {
  const server = await getApp();
  return request(server).post('/api/auth/login').send({ email, password });
}

/** Convenience: log in and return just the token, failing loudly otherwise. */
export async function tokenFor(email, password) {
  const res = await login(email, password);
  if (res.status !== 200) {
    throw new Error(`tokenFor failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

/** Creates an inventory item, returning the created item. */
export async function createItem(token, overrides = {}) {
  const server = await getApp();
  const payload = {
    name: 'Rice',
    category: 'Grains',
    quantity: 100,
    daily_usage: 2,
    unit: 'kg',
    ...overrides,
  };

  const res = await request(server)
    .post('/api/inventory/items')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

  if (res.status !== 201) {
    throw new Error(`createItem failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.item;
}

export { request };
