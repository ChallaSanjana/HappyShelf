import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { request, getApp, resetStores, registerAdmin } from './helpers/api.js';

describe('rate limiting', () => {
  beforeEach(resetStores);

  test('repeated failed logins are throttled', async () => {
    const app = await getApp();
    const { user } = await registerAdmin();

    let sawLimit = false;
    // The limiter allows 10 failures per window; 12 attempts must trip it.
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'definitelywrong1' });
      if (res.status === 429) {
        sawLimit = true;
        assert.match(res.body.error, /Too many login attempts/);
        break;
      }
    }

    assert.ok(sawLimit, 'expected the login limiter to return 429');
  });

  test('successful logins do not burn the failure budget', async () => {
    const app = await getApp();
    const { user, password } = await registerAdmin();

    for (let i = 0; i < 15; i++) {
      await request(app).post('/api/auth/login').send({ email: user.email, password }).expect(200);
    }
  });

  test('registrations are capped per window', async () => {
    const app = await getApp();

    let sawLimit = false;
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'X', email: `flood-${i}@example.com`, password: 'password123' });
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }

    assert.ok(sawLimit, 'expected the register limiter to return 429');
  });

  test('rate-limit headers are advertised', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/health');
    // Health sits before the limiter, so check an endpoint behind it.
    assert.equal(res.status, 200);

    const limited = await request(app).get('/api/inventory/items');
    assert.ok(
      limited.headers['ratelimit'] || limited.headers['ratelimit-limit'],
      'expected standard RateLimit headers'
    );
  });
});

describe('request body limits', () => {
  beforeEach(resetStores);

  test('an oversized body is rejected with 413, not 500', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();

    const huge = { name: 'x'.repeat(200 * 1024), category: 'Grains', quantity: 1, daily_usage: 1, unit: 'kg' };

    const res = await request(app)
      .post('/api/inventory/items')
      .set('Authorization', `Bearer ${token}`)
      .send(huge);

    assert.equal(res.status, 413);
  });

  test('malformed JSON is rejected with 400, not 500', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();

    const res = await request(app)
      .post('/api/inventory/items')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"name": "unclosed');

    assert.equal(res.status, 400);
  });
});
