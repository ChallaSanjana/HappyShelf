import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { request, getApp, resetStores, registerAdmin, createItem, addMember, tokenFor } from './helpers/api.js';

const isoDaysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const createPlan = async (token) => {
  const app = await getApp();
  return request(app).post('/api/action-plans').set('Authorization', `Bearer ${token}`).send({});
};

const taskFor = (plan, itemName) => plan.tasks.filter((t) => t.itemName === itemName);

describe('action plan task generation', () => {
  beforeEach(resetStores);

  test('flags an out-of-stock item for restock', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { name: 'Coffee', quantity: 5, daily_usage: 1 });

    await request(app)
      .patch(`/api/inventory/items/${item.id}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 })
      .expect(200);

    const res = await createPlan(token);
    assert.equal(res.status, 201);

    const tasks = taskFor(res.body.plan, 'Coffee');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'restock');
    assert.match(tasks[0].description, /out of stock/i);
  });

  test('flags an item with under 3 days of supply', async () => {
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Milk', quantity: 2, daily_usage: 1 });

    const res = await createPlan(token);
    const tasks = taskFor(res.body.plan, 'Milk');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'restock');
  });

  test('flags an item at or below its min_stock_level', async () => {
    // Regression: this controller kept a private isLowStock that ignored
    // min_stock_level entirely, so an item the user had explicitly marked as
    // low produced no restock task.
    const { token } = await registerAdmin();
    await createItem(token, {
      name: 'Light bulbs',
      quantity: 5,
      daily_usage: 0.1, // 50 days of runway — not low by the days rule
      min_stock_level: 5,
    });

    const res = await createPlan(token);
    const tasks = taskFor(res.body.plan, 'Light bulbs');
    assert.equal(tasks.length, 1, 'expected a restock task from min_stock_level');
    assert.equal(tasks[0].type, 'restock');
  });

  test('flags an item expiring within the window', async () => {
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Yogurt', quantity: 40, daily_usage: 1, expiry_date: isoDaysFromNow(3) });

    const res = await createPlan(token);
    const tasks = taskFor(res.body.plan, 'Yogurt');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'use_soon');
    assert.match(tasks[0].description, /expires in 3 days/i);
  });

  test('flags an ALREADY EXPIRED item', async () => {
    // The bug this pins: the old isExpiringSoon guarded on `days >= 0`, so an
    // item that had already gone off produced no task at all — the single
    // case an action plan most needs to raise.
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Bread', quantity: 5, daily_usage: 1, expiry_date: isoDaysFromNow(-4) });

    const res = await createPlan(token);
    const tasks = taskFor(res.body.plan, 'Bread');
    assert.equal(tasks.length, 1, 'expected a use_soon task for expired stock');
    assert.equal(tasks[0].type, 'use_soon');
    assert.match(tasks[0].description, /expired 4 days ago/i);
  });

  test('leaves a healthy item alone', async () => {
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Rice', quantity: 100, daily_usage: 1, expiry_date: isoDaysFromNow(200) });

    const res = await createPlan(token);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Nothing to add/i);
  });

  test('an item can be both low on stock and expiring', async () => {
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Cream', quantity: 2, daily_usage: 1, expiry_date: isoDaysFromNow(2) });

    const res = await createPlan(token);
    const tasks = taskFor(res.body.plan, 'Cream');
    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks.map((t) => t.type).sort(), ['restock', 'use_soon']);
  });
});

describe('action plan lifecycle', () => {
  beforeEach(resetStores);

  test('a task can be ticked off and stays ticked', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Milk', quantity: 1, daily_usage: 1 });

    const created = await createPlan(token);
    const plan = created.body.plan;

    await request(app)
      .patch(`/api/action-plans/${plan.id}/tasks/${plan.tasks[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true })
      .expect(200);

    const listed = await request(app)
      .get('/api/action-plans')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(listed.body.plans[0].tasks[0].done, true);
  });

  test('rejects a non-boolean done value', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Milk', quantity: 1, daily_usage: 1 });
    const plan = (await createPlan(token)).body.plan;

    await request(app)
      .patch(`/api/action-plans/${plan.id}/tasks/${plan.tasks[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ done: 'yes' })
      .expect(400);
  });

  test('a plan can be deleted', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    await createItem(token, { name: 'Milk', quantity: 1, daily_usage: 1 });
    const plan = (await createPlan(token)).body.plan;

    await request(app)
      .delete(`/api/action-plans/${plan.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const listed = await request(app).get('/api/action-plans').set('Authorization', `Bearer ${token}`);
    assert.equal(listed.body.plans.length, 0);
  });

  test('a Viewer cannot create a plan', async () => {
    const { token: adminToken } = await registerAdmin();
    await createItem(adminToken, { name: 'Milk', quantity: 1, daily_usage: 1 });
    const { email, password } = await addMember(adminToken, 'Viewer');
    const viewerToken = await tokenFor(email, password);

    const res = await createPlan(viewerToken);
    assert.equal(res.status, 403);
  });

  test("plans are scoped to the creator's household", async () => {
    const app = await getApp();
    const { token: tokenA } = await registerAdmin();
    const { token: tokenB } = await registerAdmin();

    await createItem(tokenA, { name: 'Milk', quantity: 1, daily_usage: 1 });
    await createPlan(tokenA);

    const listed = await request(app).get('/api/action-plans').set('Authorization', `Bearer ${tokenB}`);
    assert.equal(listed.body.plans.length, 0);
  });
});
