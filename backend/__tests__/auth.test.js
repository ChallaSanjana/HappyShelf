import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  request,
  getApp,
  resetStores,
  registerAdmin,
  addMember,
  login,
  tokenFor,
} from './helpers/api.js';

describe('registration', () => {
  beforeEach(resetStores);

  test('creates the household Admin and returns a token', async () => {
    const { user, token } = await registerAdmin();
    assert.equal(user.role, 'Admin');
    assert.ok(token);
    assert.equal(user.householdId, user.id);
  });

  test('rejects a password with no digit', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'a@example.com', password: 'passwordonly' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least 8 characters/);
  });

  test('rejects a duplicate email', async () => {
    const app = await getApp();
    await registerAdmin({ email: 'dupe@example.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'B', email: 'dupe@example.com', password: 'password123' });
    assert.equal(res.status, 400);
  });

  test('normalizes email case so login matches later', async () => {
    await registerAdmin({ email: 'Mixed@Example.COM' });
    const res = await login('mixed@example.com', 'password123');
    assert.equal(res.status, 200);
  });

  test('rejects a non-string email (NoSQL operator injection shape)', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: { $ne: null }, password: 'password123' });
    assert.equal(res.status, 400);
  });
});

describe('login', () => {
  beforeEach(resetStores);

  test('rejects a wrong password', async () => {
    const { user } = await registerAdmin();
    const res = await login(user.email, 'wrongpassword1');
    assert.equal(res.status, 401);
  });

  test('gives the same error for unknown email and wrong password', async () => {
    const { user } = await registerAdmin();
    const unknown = await login('nobody@example.com', 'password123');
    const wrong = await login(user.email, 'wrongpassword1');
    assert.equal(unknown.body.error, wrong.body.error);
  });

  test('a deactivated member cannot log in', async () => {
    // The bug this pins: is_active was never checked at login, so the whole
    // deactivation feature — and the last-Admin safeguard protecting it —
    // was cosmetic. A deactivated member simply logged back in.
    const app = await getApp();
    const { token } = await registerAdmin();
    const { member, email, password } = await addMember(token, 'Staff');

    assert.equal((await login(email, password)).status, 200);

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(200);

    const res = await login(email, password);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /deactivated/i);
  });

  test('deactivation is only revealed after a correct password', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const { member, email } = await addMember(token, 'Staff');

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    // Wrong password on a deactivated account must look like any other
    // failed login, or the endpoint becomes an account-status oracle.
    const res = await login(email, 'totallywrong1');
    assert.equal(res.status, 401);
    assert.doesNotMatch(res.body.error, /deactivated/i);
  });
});

describe('token revocation', () => {
  beforeEach(resetStores);

  test('an existing session stops working once the account is deactivated', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { member, email, password } = await addMember(adminToken, 'Staff');
    const staffToken = await tokenFor(email, password);

    await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);

    // Previously this kept working for up to 7 days, until the JWT expired.
    const res = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${staffToken}`);
    assert.equal(res.status, 403);
  });

  test('a demotion takes effect on the existing session immediately', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { member, email, password } = await addMember(adminToken, 'Manager');
    const managerToken = await tokenFor(email, password);

    await request(app)
      .get('/api/team')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'Viewer' })
      .expect(200);

    // Old token carried role=Manager; the live role is now Viewer.
    const res = await request(app).get('/api/team').set('Authorization', `Bearer ${managerToken}`);
    assert.equal(res.status, 401);
  });

  test('a deleted member cannot keep using their token', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { member, email, password } = await addMember(adminToken, 'Staff');
    const staffToken = await tokenFor(email, password);

    await request(app)
      .delete(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${staffToken}`);
    assert.equal(res.status, 401);
  });

  test('a no-op role write does not log the member out', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { member, email, password } = await addMember(adminToken, 'Staff');
    const staffToken = await tokenFor(email, password);

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'Staff', name: 'Renamed' })
      .expect(200);

    await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
  });

  test('a password reset revokes outstanding sessions', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { member, email, password } = await addMember(adminToken, 'Staff');
    const staffToken = await tokenFor(email, password);

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'brandnewpass1' })
      .expect(200);

    const res = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${staffToken}`);
    assert.equal(res.status, 401);
  });
});

describe('authentication guards', () => {
  beforeEach(resetStores);

  test('no token is rejected', async () => {
    const app = await getApp();
    await request(app).get('/api/inventory/items').expect(401);
  });

  test('a garbage token is rejected', async () => {
    const app = await getApp();
    await request(app)
      .get('/api/inventory/items')
      .set('Authorization', 'Bearer not.a.real.token')
      .expect(401);
  });

  test('health check needs no token', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'OK');
  });

  test('unknown routes return JSON 404, not HTML', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not found');
  });

  test('security headers are present', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['x-frame-options'] || res.headers['content-security-policy']);
  });
});
