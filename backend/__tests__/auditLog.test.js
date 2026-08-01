import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { getApp, resetStores, registerAdmin, addMember, createItem, tokenFor } from './helpers/api.js';

/**
 * The audit trail, and who is allowed to read it.
 *
 * The access question matters as much as the recording: a log that anyone
 * on the team can read is a different feature from one only an Admin can.
 */

describe('audit log access', () => {
  beforeEach(resetStores);

  test('an Admin can read their household audit log', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();

    const res = await request(app).get('/api/audit-log').set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.entries));
  });

  for (const role of ['Manager', 'Staff', 'Viewer']) {
    test(`a ${role} is refused`, async () => {
      const app = await getApp();
      const { token: adminToken } = await registerAdmin();
      const member = await addMember(adminToken, role);
      const memberToken = await tokenFor(member.email, member.password);

      const res = await request(app)
        .get('/api/audit-log')
        .set('Authorization', `Bearer ${memberToken}`);

      assert.equal(res.status, 403);
    });
  }

  test('an unauthenticated request is refused', async () => {
    const app = await getApp();
    assert.equal((await request(app).get('/api/audit-log')).status, 401);
  });

  test('one household cannot read another household\'s log', async () => {
    const app = await getApp();
    const a = await registerAdmin();
    const b = await registerAdmin();

    await createItem(a.token, { name: 'Household A Rice' });

    const res = await request(app)
      .get('/api/audit-log')
      .set('Authorization', `Bearer ${b.token}`);

    assert.equal(res.status, 200);
    const names = res.body.entries.map((e) => e.targetName);
    assert.ok(!names.includes('Household A Rice'));
  });
});

describe('audit log recording', () => {
  beforeEach(resetStores);

  async function entriesFor(token) {
    const app = await getApp();
    const res = await request(app)
      .get('/api/audit-log?limit=200')
      .set('Authorization', `Bearer ${token}`);
    return res.body.entries;
  }

  test('creating an item is recorded with the actor and the item', async () => {
    const { token, user } = await registerAdmin();
    await createItem(token, { name: 'Audited Rice', quantity: 12 });

    const entry = (await entriesFor(token)).find((e) => e.action === 'item.created');
    assert.ok(entry, 'expected an item.created entry');
    assert.equal(entry.targetName, 'Audited Rice');
    assert.equal(entry.targetType, 'item');
    assert.equal(entry.actorEmail, user.email);
    assert.equal(entry.details.quantity, 12);
  });

  test('consume and reorder are recorded with their quantities', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { name: 'Milk', quantity: 10, daily_usage: 1 });

    await request(app)
      .patch(`/api/inventory/items/${item.id}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 4 });

    await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 6 });

    const entries = await entriesFor(token);
    const consumed = entries.find((e) => e.action === 'item.consumed');
    const reordered = entries.find((e) => e.action === 'item.reordered');

    assert.equal(consumed.details.quantityConsumed, 4);
    assert.equal(consumed.details.remainingQuantity, 6);
    assert.equal(reordered.details.quantityAdded, 6);
    assert.equal(reordered.details.newQuantity, 12);
  });

  test('deleting an item is recorded after the item is gone', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { name: 'Doomed' });

    await request(app)
      .delete(`/api/inventory/items/${item.id}`)
      .set('Authorization', `Bearer ${token}`);

    const entry = (await entriesFor(token)).find((e) => e.action === 'item.deleted');
    assert.ok(entry);
    assert.equal(entry.targetName, 'Doomed');
  });

  test('bulk import records how many landed and how many were skipped', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();

    await request(app)
      .post('/api/inventory/items/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          { name: 'Good', category: 'Food', quantity: 5, daily_usage: 1, unit: 'kg' },
          { name: '', category: 'Food', quantity: 5, daily_usage: 1, unit: 'kg' },
        ],
      });

    const entry = (await entriesFor(token)).find((e) => e.action === 'items.imported');
    assert.equal(entry.details.created, 1);
    assert.equal(entry.details.skipped, 1);
  });

  test('adding a member and changing their role are separate entries', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const { member } = await addMember(token, 'Staff');

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Manager' });

    const entries = await entriesFor(token);
    assert.ok(entries.find((e) => e.action === 'member.added'));

    const roleChange = entries.find((e) => e.action === 'member.role_changed');
    assert.ok(roleChange, 'expected a member.role_changed entry');
    assert.equal(roleChange.details.from, 'Staff');
    assert.equal(roleChange.details.to, 'Manager');
  });

  test('deactivation and removal are recorded distinctly', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const { member: staff } = await addMember(token, 'Staff');
    const { member: other } = await addMember(token, 'Viewer');

    await request(app)
      .put(`/api/team/${staff.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    await request(app)
      .delete(`/api/team/${other.id}`)
      .set('Authorization', `Bearer ${token}`);

    const entries = await entriesFor(token);
    assert.ok(entries.find((e) => e.action === 'member.deactivated'));
    assert.ok(entries.find((e) => e.action === 'member.removed'));
  });

  test('a password change records the fact but never the password', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const { member } = await addMember(token, 'Staff');

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'a-brand-new-password-1' });

    const entry = (await entriesFor(token)).find((e) => e.action === 'member.password_reset');
    assert.ok(entry);
    const serialised = JSON.stringify(entry);
    assert.ok(!serialised.includes('a-brand-new-password-1'), 'password must not appear in the log');
  });

  test('registering a household records its own account.registered entry', async () => {
    const { token, user } = await registerAdmin();

    const entry = (await entriesFor(token)).find((e) => e.action === 'account.registered');
    assert.ok(entry, 'expected an account.registered entry');
    assert.equal(entry.targetName, user.name);
    assert.equal(entry.actorEmail, user.email);
  });

  test('updating your own profile records account.profile_updated', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();

    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'A New Name' });

    const entry = (await entriesFor(token)).find((e) => e.action === 'account.profile_updated');
    assert.ok(entry, 'expected an account.profile_updated entry');
    assert.deepEqual(entry.details.fields, ['name']);
  });

  test('entries come back newest first', async () => {
    const { token } = await registerAdmin();
    await createItem(token, { name: 'First' });
    await createItem(token, { name: 'Second' });

    const created = (await entriesFor(token)).filter((e) => e.action === 'item.created');
    assert.equal(created[0].targetName, 'Second');
    assert.equal(created[1].targetName, 'First');
  });

  test('the log is paginated', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    for (let i = 0; i < 5; i += 1) {
      await createItem(token, { name: `Item ${i}` });
    }

    const res = await request(app)
      .get('/api/audit-log?limit=2&page=1')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.body.entries.length, 2);
    assert.equal(res.body.page, 1);
    assert.ok(res.body.total >= 5);
    assert.ok(res.body.totalPages >= 3);
  });

  test('the log can be filtered by action', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const item = await createItem(token, { name: 'Filtered' });
    await request(app)
      .patch(`/api/inventory/items/${item.id}/consume`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 });

    const res = await request(app)
      .get('/api/audit-log?action=item.consumed')
      .set('Authorization', `Bearer ${token}`);

    assert.ok(res.body.entries.length > 0);
    assert.ok(res.body.entries.every((e) => e.action === 'item.consumed'));
  });

  test('there is no endpoint to alter or delete an entry', async () => {
    const app = await getApp();
    const { token } = await registerAdmin();
    const auth = { Authorization: `Bearer ${token}` };

    // An audit log the audited party can rewrite is worse than none.
    for (const method of ['post', 'put', 'patch', 'delete']) {
      const res = await request(app)[method]('/api/audit-log').set(auth).send({});
      assert.equal(res.status, 404, `${method.toUpperCase()} /api/audit-log should not exist`);
    }
  });
});
