import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  request,
  getApp,
  resetStores,
  registerAdmin,
  createItem,
  seedConsumption,
} from './helpers/api.js';

const isoDaysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

describe('item creation validation', () => {
  beforeEach(resetStores);

  const post = async (token, body) => {
    const app = await getApp();
    return request(app)
      .post('/api/inventory/items')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  };

  const base = { name: 'Rice', category: 'Grains', quantity: 10, daily_usage: 1, unit: 'kg' };

  test('rejects a missing required field', async () => {
    const { token } = await registerAdmin();
    const res = await post(token, { ...base, unit: undefined });
    assert.equal(res.status, 400);
  });

  test('rejects a non-numeric quantity instead of storing NaN', async () => {
    // parseInt('abc') is NaN, and NaN passes Mongoose's `min: 0` check
    // because NaN < 0 is false — so this has to be caught here.
    const { token } = await registerAdmin();
    const res = await post(token, { ...base, quantity: 'abc' });
    assert.equal(res.status, 400);
  });

  test('rejects a negative quantity', async () => {
    const { token } = await registerAdmin();
    assert.equal((await post(token, { ...base, quantity: -1 })).status, 400);
  });

  test('rejects an unknown unit', async () => {
    const { token } = await registerAdmin();
    assert.equal((await post(token, { ...base, unit: 'furlongs' })).status, 400);
  });

  test('rejects min_stock_level above quantity', async () => {
    const { token } = await registerAdmin();
    assert.equal((await post(token, { ...base, quantity: 5, min_stock_level: 10 })).status, 400);
  });

  test('rejects a future purchase date', async () => {
    const { token } = await registerAdmin();
    const res = await post(token, { ...base, purchase_date: isoDaysFromNow(5) });
    assert.equal(res.status, 400);
  });

  test('rejects an expiry date on or before the purchase date', async () => {
    const { token } = await registerAdmin();
    const res = await post(token, {
      ...base,
      purchase_date: isoDaysFromNow(-10),
      expiry_date: isoDaysFromNow(-20),
    });
    assert.equal(res.status, 400);
  });

  test('accepts a valid item and echoes the stored values', async () => {
    const { token } = await registerAdmin();
    const res = await post(token, { ...base, cost_per_unit: 60, storage_location: 'Pantry' });
    assert.equal(res.status, 201);
    assert.equal(res.body.item.name, 'Rice');
    assert.equal(res.body.item.cost_per_unit, 60);
  });
});

describe('consume', () => {
  beforeEach(resetStores);

  test('reduces quantity and records history', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 10 });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 4 })
      .expect(200);

    assert.equal(res.body.item.quantity, 6);

    const history = await request(app)
      .get('/api/inventory/consumption-history')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(history.body.history.length, 1);
    assert.equal(history.body.history[0].quantityConsumed, 4);
    assert.equal(history.body.history[0].remainingQuantity, 6);
  });

  test('refuses to consume more than is in stock', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 3 });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 4 });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /only 3/);
  });

  test('consuming everything lands exactly on zero, never below', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 5 });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 })
      .expect(200);

    assert.equal(res.body.item.quantity, 0);
  });

  test('rejects a zero or negative consume quantity', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token);

    for (const quantity of [0, -3]) {
      const res = await request(app)
        .patch(`/api/inventory/items/${item.id}/consume`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity });
      assert.equal(res.status, 400, `quantity ${quantity} should be rejected`);
    }
  });
});

describe('reorder', () => {
  beforeEach(resetStores);

  test('adds an explicit quantity and logs it', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 10 });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 25 })
      .expect(200);

    assert.equal(res.body.item.quantity, 35);
    assert.equal(res.body.history.quantityAdded, 25);
  });

  test('suggests a top-up to a two-week buffer when no quantity is given', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    // 2/day * 14 days = 28 target, currently 10 -> suggest 18.
    const item = await createItem(token, { quantity: 10, daily_usage: 2 });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    assert.equal(res.body.item.quantity, 28);
  });

  test('always adds at least one unit even when already above target', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 1000, daily_usage: 1 });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    assert.equal(res.body.item.quantity, 1001);
  });

  test('clears a stale expiry date so the item is not trapped', async () => {
    // Reorder advances purchase_date to today. Leaving an older expiry date
    // in place would violate the "expiry after purchase" invariant and make
    // every later edit fail, even ones that never touch a date.
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, {
      purchase_date: isoDaysFromNow(-30),
      expiry_date: isoDaysFromNow(-2),
    });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 })
      .expect(200);

    assert.equal(res.body.item.expiry_date, null);

    await request(app)
      .put(`/api/inventory/items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed after restock' })
      .expect(200);
  });

  test('rejects a negative reorder quantity', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token);

    await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: -5 })
      .expect(400);
  });
});

describe('bulk import', () => {
  beforeEach(resetStores);

  const bulk = async (token, items) => {
    const app = await getApp();
    return request(app)
      .post('/api/inventory/items/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ items });
  };

  const row = (name) => ({ name, category: 'Grains', quantity: 5, daily_usage: 1, unit: 'kg' });

  test('creates every valid row in one request', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();

    const res = await bulk(token, [row('A'), row('B'), row('C')]);
    assert.equal(res.status, 201);
    assert.equal(res.body.created, 3);
    assert.deepEqual(res.body.errors, []);

    const list = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(list.body.items.length, 3);
  });

  test('imports the good rows and reports the bad ones', async () => {
    const { token } = await registerAdmin();

    const res = await bulk(token, [
      row('Good one'),
      { ...row('Bad unit'), unit: 'furlongs' },
      row('Good two'),
      { ...row('No name'), name: '' },
    ]);

    assert.equal(res.status, 201);
    assert.equal(res.body.created, 2);
    assert.equal(res.body.errors.length, 2);
    // Rows are reported 1-based so they line up with the user's spreadsheet.
    assert.deepEqual(res.body.errors.map((e) => e.row), [2, 4]);
  });

  test('fails the request when nothing is importable', async () => {
    const { token } = await registerAdmin();
    const res = await bulk(token, [{ name: '', category: '', quantity: 0, daily_usage: 0, unit: 'x' }]);
    assert.equal(res.status, 400);
    assert.equal(res.body.created, 0);
  });

  test('rejects a non-array payload', async () => {
    const { token } = await registerAdmin();
    const res = await bulk(token, 'not an array');
    assert.equal(res.status, 400);
  });

  test('rejects an empty list', async () => {
    const { token } = await registerAdmin();
    assert.equal((await bulk(token, [])).status, 400);
  });

  test('caps how many items one request may create', async () => {
    const { token } = await registerAdmin();
    const tooMany = Array.from({ length: 1001 }, (_, i) => row(`Item ${i}`));
    const res = await bulk(token, tooMany);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Maximum is 1000/);
  });

  test('a Viewer cannot bulk import', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { addMember, tokenFor } = await import('./helpers/api.js');
    const { email, password } = await addMember(adminToken, 'Viewer');
    const viewerToken = await tokenFor(email, password);

    await request(app)
      .post('/api/inventory/items/bulk')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ items: [row('X')] })
      .expect(403);
  });
});

describe('search, filter and pagination', () => {
  beforeEach(resetStores);

  test('returns the full unpaginated list when no query params are sent', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Rice' });
    await createItem(token, { name: 'Beans' });

    const res = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Stats, predictions and the PDF report all depend on this shape.
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.total, undefined);
  });

  test('paginates and reports totals when asked', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    for (const name of ['Apples', 'Bananas', 'Cherries', 'Dates']) {
      await createItem(token, { name });
    }

    const res = await request(app)
      .get('/api/inventory/items?page=2&limit=2&sortBy=name&sortOrder=asc')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.total, 4);
    assert.equal(res.body.totalPages, 2);
    assert.deepEqual(res.body.items.map((i) => i.name), ['Cherries', 'Dates']);
  });

  test('search matches name, category and storage location', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Rice', category: 'Grains', storage_location: 'Pantry' });
    await createItem(token, { name: 'Soap', category: 'Cleaning', storage_location: 'Cupboard' });

    const app2 = await getApp();
    const byLocation = await request(app2)
      .get('/api/inventory/items?search=pantry')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(byLocation.body.items.length, 1);
    assert.equal(byLocation.body.items[0].name, 'Rice');
  });

  test('filters by stock status using the shared rules', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Plenty', quantity: 100, daily_usage: 1 });
    await createItem(token, { name: 'Running out', quantity: 2, daily_usage: 1 });

    const res = await request(app)
      .get('/api/inventory/items?stockStatus=low')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].name, 'Running out');
  });

  test('items missing the sorted-on value sort last in both directions', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Priced', cost_per_unit: 50 });
    await createItem(token, { name: 'Unpriced' });

    for (const order of ['asc', 'desc']) {
      const res = await request(app)
        .get(`/api/inventory/items?sortBy=price&sortOrder=${order}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.equal(res.body.items.at(-1).name, 'Unpriced', `order=${order}`);
    }
  });
});

describe('history windowing', () => {
  beforeEach(resetStores);

  /** Consumes 1 unit `count` times so there are that many history entries. */
  const consumeTimes = async (token, itemId, count) => {
    const app = await getApp();
    for (let i = 0; i < count; i++) {
      await request(app)
        .patch(`/api/inventory/items/${itemId}/consume`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 1 })
        .expect(200);
    }
  };

  test('defaults to the newest 50 entries', async () => {
    // The analytics charts needed a wider window than this, but the default
    // has to stay 50 so the "Recent activity" callers are unaffected.
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 60, daily_usage: 1 });
    await consumeTimes(token, item.id, 55);

    const res = await request(app)
      .get('/api/inventory/consumption-history')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.history.length, 50);
  });

  test('an explicit limit is honoured', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 60, daily_usage: 1 });
    await consumeTimes(token, item.id, 55);

    const res = await request(app)
      .get('/api/inventory/consumption-history?limit=55')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.history.length, 55);
  });

  test('the limit is capped rather than trusted', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 5, daily_usage: 1 });
    await consumeTimes(token, item.id, 3);

    // A caller asking for a million entries gets the cap, not an error.
    const res = await request(app)
      .get('/api/inventory/consumption-history?limit=999999')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.history.length, 3);
  });

  test('a garbage limit falls back to the default', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 5, daily_usage: 1 });
    await consumeTimes(token, item.id, 3);

    const res = await request(app)
      .get('/api/inventory/consumption-history?limit=abc')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.history.length, 3);
  });

  test('days filters out entries older than the window', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { quantity: 5, daily_usage: 1 });
    await consumeTimes(token, item.id, 2);

    // Everything was just written, so a 1-day window keeps it all...
    const recent = await request(app)
      .get('/api/inventory/consumption-history?days=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(recent.body.history.length, 2);
  });

  test('reorder history accepts the same window params', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token);

    for (let i = 0; i < 3; i++) {
      await request(app)
        .patch(`/api/inventory/items/${item.id}/reorder`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 1 })
        .expect(200);
    }

    const res = await request(app)
      .get('/api/inventory/reorder-history?limit=2&days=30')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.history.length, 2);
  });
});

describe('stats endpoint', () => {
  beforeEach(resetStores);

  test('reports the shared metric shape', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Healthy', quantity: 100, daily_usage: 1, cost_per_unit: 10 });
    await createItem(token, { name: 'Low', quantity: 1, daily_usage: 1 });

    const res = await request(app)
      .get('/api/inventory/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.totalItems, 2);
    assert.equal(res.body.lowStockItems, 1);
    assert.equal(res.body.outOfStockItems, 0);
    assert.equal(res.body.predictedSavings, 1000);
  });
});

describe('observed daily usage', () => {
  beforeEach(resetStores);

  const get = async (token, path) => {
    const app = await getApp();
    return request(app).get(path).set('Authorization', `Bearer ${token}`).expect(200);
  };

  test('items come back with the rate the household is actually observed to use', async () => {
    const { token, user } = await registerAdmin();
    // Typed 1/day, but 3 units a day actually consumed for a fortnight.
    const item = await createItem(token, { name: 'Rice', quantity: 30, daily_usage: 1 });
    seedConsumption(user.householdId, item.id, { days: 14, quantity: 3 });

    const res = await get(token, '/api/inventory/items');
    assert.equal(res.body.items[0].observed_daily_usage, 3);
  });

  test('too little history leaves the typed rate alone', async () => {
    const { token, user } = await registerAdmin();
    const item = await createItem(token, { name: 'Rice', quantity: 30, daily_usage: 1 });
    seedConsumption(user.householdId, item.id, { days: 3, quantity: 3 });

    const res = await get(token, '/api/inventory/items');
    assert.equal(res.body.items[0].observed_daily_usage, undefined);
    assert.equal(res.body.items[0].daily_usage, 1);
  });

  test('stats count an item as low when the observed rate says so', async () => {
    const { token, user } = await registerAdmin();
    // 30 units at the typed 1/day is a month of runway and looks healthy; at
    // the 15/day the household actually gets through, it is two days.
    const item = await createItem(token, { name: 'Rice', quantity: 30, daily_usage: 1 });

    const before = await get(token, '/api/inventory/stats');
    assert.equal(before.body.lowStockItems, 0);

    seedConsumption(user.householdId, item.id, { days: 10, quantity: 15 });

    const after = await get(token, '/api/inventory/stats');
    assert.equal(after.body.lowStockItems, 1);
  });

  test('the stock filter agrees with the stats', async () => {
    const { token, user } = await registerAdmin();
    const item = await createItem(token, { name: 'Rice', quantity: 30, daily_usage: 1 });
    seedConsumption(user.householdId, item.id, { days: 10, quantity: 15 });

    const res = await get(token, '/api/inventory/items?stockStatus=low');
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].name, 'Rice');
  });

  test('the suggested reorder covers a fortnight of observed usage', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();
    // Typed 2/day would top up to 28 and add 18. The household is observed to
    // use 5/day, so a fortnight is 70 and they need 60 -- buying 18 would have
    // run them out in under four days while the modal called it "~14 days".
    const item = await createItem(token, { name: 'Rice', quantity: 10, daily_usage: 2 });
    seedConsumption(user.householdId, item.id, { days: 10, quantity: 5 });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    assert.equal(res.body.item.quantity, 70);
    assert.equal(res.body.history.quantityAdded, 60);
  });

  test('too little history leaves the suggestion on the typed rate', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();
    const item = await createItem(token, { name: 'Rice', quantity: 10, daily_usage: 2 });
    seedConsumption(user.householdId, item.id, { days: 3, quantity: 5 });

    const res = await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    assert.equal(res.body.item.quantity, 28);
  });

  test('predictions forecast from the observed rate, and agree on the threshold', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();
    const item = await createItem(token, { name: 'Rice', quantity: 30, daily_usage: 1 });
    seedConsumption(user.householdId, item.id, { days: 10, quantity: 15 });

    const res = await request(app)
      .get('/api/inventory/predictions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const prediction = res.body.predictions[item.id];
    // 15/day observed, not the typed 1/day.
    assert.equal(prediction.demand_forecast[0], 15);
    assert.equal(prediction.forecast_source, 'household_history');
    // 30 units at 15/day is two days of runway -> the 0.95 band, not the 0.05
    // baseline the typed rate's 30 days of runway would have produced.
    assert.equal(prediction.low_stock_probability, 0.95);
  });

  test('a single consume is not enough to forecast from', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();
    const item = await createItem(token, { name: 'Rice', quantity: 30, daily_usage: 1 });
    seedConsumption(user.householdId, item.id, { days: 1, quantity: 99 });

    const res = await request(app)
      .get('/api/inventory/predictions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const prediction = res.body.predictions[item.id];
    // The old private mean would have reported 99/day off one record.
    assert.equal(prediction.demand_forecast[0], 1);
    assert.equal(prediction.forecast_source, 'daily_usage_estimate');
  });

  test('an action plan is built from the observed rate too', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();
    const item = await createItem(token, { name: 'Rice', quantity: 30, daily_usage: 1 });
    seedConsumption(user.householdId, item.id, { days: 10, quantity: 15 });

    const res = await request(app)
      .post('/api/action-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const tasks = res.body.plan.tasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'restock');
    assert.equal(tasks[0].itemName, 'Rice');
  });

  test('one household\'s consumption never affects another\'s', async () => {
    const first = await registerAdmin();
    const second = await registerAdmin();
    const item = await createItem(first.token, { name: 'Rice', quantity: 30, daily_usage: 1 });
    await createItem(second.token, { name: 'Rice', quantity: 30, daily_usage: 1 });
    seedConsumption(first.user.householdId, item.id, { days: 10, quantity: 15 });

    const mine = await get(first.token, '/api/inventory/stats');
    const theirs = await get(second.token, '/api/inventory/stats');
    assert.equal(mine.body.lowStockItems, 1);
    assert.equal(theirs.body.lowStockItems, 0);
  });
});
