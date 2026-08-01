import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import request from 'supertest';

import { getApp, resetStores, registerAdmin, addMember, login, tokenFor } from './helpers/api.js';
import { findDevResetToken } from '../src/store/devStore.js';

/**
 * Forgot/reset password.
 *
 * /forgot-password never returns the raw token — it exists only in the
 * email that gets sent, which is exactly the thing these tests have no way
 * to observe. So `requestReset` below temporarily makes crypto.randomBytes
 * deterministic, which lets a test know in advance exactly which raw token
 * the endpoint will generate, without weakening the real code path at all:
 * production still calls the real crypto.randomBytes on every request.
 *
 * `crypto.randomBytes` is safely patchable here because `import crypto from
 * 'crypto'` in ESM yields the same plain, mutable object `require('crypto')`
 * would — unlike a named export binding, which is frozen.
 */

const FIXED_RAW_TOKEN = Buffer.alloc(32, 0x42).toString('hex');

async function requestReset(app, email) {
  const original = crypto.randomBytes;
  crypto.randomBytes = (n) => Buffer.alloc(n, 0x42);
  try {
    return await request(app).post('/api/auth/forgot-password').send({ email });
  } finally {
    crypto.randomBytes = original;
  }
}

function hashOfFixedToken() {
  return crypto.createHash('sha256').update(FIXED_RAW_TOKEN).digest('hex');
}

describe('forgot password', () => {
  beforeEach(resetStores);

  test('a registered email gets a generic 200', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();

    const res = await requestReset(app, user.email);
    assert.equal(res.status, 200);
    assert.match(res.body.message, /reset link/i);
  });

  test('an unregistered email gets the exact same response', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();

    const known = await requestReset(app, user.email);
    const unknown = await requestReset(app, 'nobody-here@example.com');

    // Saying "no such user" would turn this into a free membership oracle.
    assert.equal(unknown.status, known.status);
    assert.deepEqual(unknown.body, known.body);
  });

  test('missing email is a 400, not a silent 200', async () => {
    const app = await getApp();
    const res = await request(app).post('/api/auth/forgot-password').send({});
    assert.equal(res.status, 400);
  });

  test('a non-string email is rejected rather than reaching a lookup', async () => {
    const app = await getApp();
    // The same defence as login/register: an object payload must not reach
    // whatever the email gets compared against.
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: { $ne: null } });
    assert.equal(res.status, 400);
  });

  test('a deactivated account is not reachable via reset', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { member } = await addMember(adminToken, 'Staff');

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    const forgotRes = await requestReset(app, member.email);
    assert.equal(forgotRes.status, 200); // still generic

    // No token was actually issued, so the link it would have produced does
    // not work.
    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'NewPassw0rd1' });
    assert.equal(resetRes.status, 400);
  });

  test('never stores the raw token, only its hash', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();
    await requestReset(app, user.email);

    const record = findDevResetToken(hashOfFixedToken());
    assert.ok(record, 'expected a token record to exist');

    const serialised = JSON.stringify(record);
    assert.ok(!serialised.includes(FIXED_RAW_TOKEN), 'the raw token must never be persisted');
    assert.deepEqual(Object.keys(record).sort(), ['expiresAt', 'usedAt', 'userId']);
  });

  test('is rate limited', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();

    for (let i = 0; i < 10; i += 1) {
      const res = await requestReset(app, user.email);
      assert.notEqual(res.status, 429, `request ${i + 1} should not be limited yet`);
    }

    const limited = await requestReset(app, user.email);
    assert.equal(limited.status, 429);
  });
});

describe('reset password', () => {
  beforeEach(resetStores);

  test('a valid token sets the new password and it can be used to log in', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();
    await requestReset(app, user.email);

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'BrandNewPassw0rd' });

    assert.equal(res.status, 200);

    const loginRes = await login(user.email, 'BrandNewPassw0rd');
    assert.equal(loginRes.status, 200);
  });

  test('the old password stops working after a reset', async () => {
    const app = await getApp();
    const { user } = await registerAdmin({ password: 'OriginalPassw0rd' });
    await requestReset(app, user.email);

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'BrandNewPassw0rd' });

    const res = await login(user.email, 'OriginalPassw0rd');
    assert.equal(res.status, 401);
  });

  test('a token can only be used once', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();
    await requestReset(app, user.email);

    const first = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'FirstNewPassw0rd' });
    assert.equal(first.status, 200);

    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'SecondNewPassw0rd' });
    assert.equal(replay.status, 400);

    // The first password change is the one that stuck, not the replay.
    assert.equal((await login(user.email, 'FirstNewPassw0rd')).status, 200);
    assert.equal((await login(user.email, 'SecondNewPassw0rd')).status, 401);
  });

  test('an expired token is rejected', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();
    await requestReset(app, user.email);

    // Force expiry directly rather than waiting on real time or a
    // file-wide short TTL, which would risk every other test in this file
    // racing against the same clock.
    const record = findDevResetToken(hashOfFixedToken());
    record.expiresAt = Date.now() - 1000;

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'BrandNewPassw0rd' });
    assert.equal(res.status, 400);
  });

  test('a token that was never issued is rejected the same way', async () => {
    const app = await getApp();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: 'BrandNewPassw0rd' });
    assert.equal(res.status, 400);
  });

  test('a weak new password is rejected before the token is spent', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();
    await requestReset(app, user.email);

    const weak = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'short1' });
    assert.equal(weak.status, 400);

    // The token must still be live — a rejected password must not burn it.
    const strong = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'NowStrongEnough1' });
    assert.equal(strong.status, 200);
  });

  test('resetting invalidates every existing session for the account', async () => {
    const app = await getApp();
    const { user, token: oldSessionToken } = await registerAdmin();

    // The old session works before the reset.
    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldSessionToken}`);
    assert.equal(before.status, 200);

    await requestReset(app, user.email);
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: FIXED_RAW_TOKEN, password: 'BrandNewPassw0rd' });

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldSessionToken}`);
    assert.equal(after.status, 401);

    // A fresh login gets a session that works again.
    const freshToken = await tokenFor(user.email, 'BrandNewPassw0rd');
    const withFresh = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${freshToken}`);
    assert.equal(withFresh.status, 200);
  });

  test('missing token or password is a 400', async () => {
    const app = await getApp();
    assert.equal((await request(app).post('/api/auth/reset-password').send({ password: 'BrandNewPassw0rd1' })).status, 400);
    assert.equal((await request(app).post('/api/auth/reset-password').send({ token: FIXED_RAW_TOKEN })).status, 400);
  });

  test('is rate limited', async () => {
    const app = await getApp();

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'not-a-real-token', password: 'BrandNewPassw0rd1' });
      assert.notEqual(res.status, 429, `request ${i + 1} should not be limited yet`);
    }

    const limited = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'BrandNewPassw0rd1' });
    assert.equal(limited.status, 429);
  });
});
