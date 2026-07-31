import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  request,
  getApp,
  resetStores,
  registerAdmin,
  addMember,
  tokenFor,
  createItem,
} from './helpers/api.js';

describe('role gates on inventory', () => {
  beforeEach(resetStores);

  test('a Viewer can read but not write', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { email, password } = await addMember(adminToken, 'Viewer');
    const viewerToken = await tokenFor(email, password);

    await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    await request(app)
      .post('/api/inventory/items')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'X', category: 'Y', quantity: 1, daily_usage: 1, unit: 'pcs' })
      .expect(403);
  });

  test('a Viewer cannot consume or reorder', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const item = await createItem(adminToken);
    const { email, password } = await addMember(adminToken, 'Viewer');
    const viewerToken = await tokenFor(email, password);

    await request(app)
      .patch(`/api/inventory/items/${item.id}/consume`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ quantity: 1 })
      .expect(403);

    await request(app)
      .patch(`/api/inventory/items/${item.id}/reorder`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({})
      .expect(403);
  });

  test('Staff can write inventory but cannot reach the team panel', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { email, password } = await addMember(adminToken, 'Staff');
    const staffToken = await tokenFor(email, password);

    await createItem(staffToken, { name: 'Staff item' });

    await request(app).get('/api/team').set('Authorization', `Bearer ${staffToken}`).expect(403);
  });
});

describe('team hierarchy', () => {
  beforeEach(resetStores);

  test('a Manager cannot create an Admin', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { email, password } = await addMember(adminToken, 'Manager');
    const managerToken = await tokenFor(email, password);

    const res = await request(app)
      .post('/api/team')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Sneaky', email: 'sneaky@example.com', password: 'password123', role: 'Admin' });

    assert.equal(res.status, 403);
  });

  test('a Manager cannot promote anyone to Manager', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { email, password } = await addMember(adminToken, 'Manager');
    const managerToken = await tokenFor(email, password);
    const { member: staff } = await addMember(adminToken, 'Staff');

    const res = await request(app)
      .put(`/api/team/${staff.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'Manager' });

    assert.equal(res.status, 403);
  });

  test('a Manager cannot demote an Admin', async () => {
    const app = await getApp();
    const { token: adminToken, user: admin } = await registerAdmin();
    const { email, password } = await addMember(adminToken, 'Manager');
    const managerToken = await tokenFor(email, password);

    const res = await request(app)
      .put(`/api/team/${admin.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'Viewer' });

    assert.equal(res.status, 403);
  });

  test('a Manager cannot deactivate a peer Manager', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { email, password } = await addMember(adminToken, 'Manager');
    const managerToken = await tokenFor(email, password);
    const { member: otherManager } = await addMember(adminToken, 'Manager');

    const res = await request(app)
      .put(`/api/team/${otherManager.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ isActive: false });

    assert.equal(res.status, 403);
  });

  test('a Manager may manage Staff and Viewers', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { email, password } = await addMember(adminToken, 'Manager');
    const managerToken = await tokenFor(email, password);
    const { member: staff } = await addMember(adminToken, 'Staff');

    await request(app)
      .put(`/api/team/${staff.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'Viewer' })
      .expect(200);
  });

  test('a Manager cannot escalate their own role', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { member, email, password } = await addMember(adminToken, 'Manager');
    const managerToken = await tokenFor(email, password);

    const res = await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'Admin' });

    assert.equal(res.status, 403);
  });

  test('anyone with team access may edit their own profile fields', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    const { member, email, password } = await addMember(adminToken, 'Manager');
    const managerToken = await tokenFor(email, password);

    await request(app)
      .put(`/api/team/${member.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'New Name' })
      .expect(200);
  });
});

describe('last-Admin safeguard', () => {
  beforeEach(resetStores);

  test('the sole Admin cannot demote themselves', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();

    const res = await request(app)
      .put(`/api/team/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Viewer' });

    assert.equal(res.status, 403);
    assert.match(res.body.error, /at least one Admin/i);
  });

  test('the sole Admin cannot deactivate themselves', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();

    const res = await request(app)
      .put(`/api/team/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    assert.equal(res.status, 403);
  });

  test('demotion is allowed once a second Admin exists', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();
    await addMember(token, 'Admin');

    await request(app)
      .put(`/api/team/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Manager' })
      .expect(200);
  });

  test('a deactivated Admin does not count toward the safeguard', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();
    const { member: secondAdmin } = await addMember(token, 'Admin');

    await request(app)
      .put(`/api/team/${secondAdmin.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
      .expect(200);

    // Only one *active* Admin remains, so this must now be blocked again.
    const res = await request(app)
      .put(`/api/team/${user.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Manager' });

    assert.equal(res.status, 403);
  });

  test('you cannot delete yourself from the team panel', async () => {
    const app = await getApp();
    const { token, user } = await registerAdmin();

    const res = await request(app)
      .delete(`/api/team/${user.id}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 400);
  });
});

describe('household isolation', () => {
  beforeEach(resetStores);

  test('one household cannot see another household\'s items', async () => {
    const app = await getApp();
    const { token: tokenA } = await registerAdmin();
    const { token: tokenB } = await registerAdmin();

    await createItem(tokenA, { name: 'Household A rice' });

    const res = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    assert.equal(res.body.items.length, 0);
  });

  test('one household cannot modify another household\'s item', async () => {
    const app = await getApp();
    const { token: tokenA } = await registerAdmin();
    const { token: tokenB } = await registerAdmin();
    const item = await createItem(tokenA);

    await request(app)
      .put(`/api/inventory/items/${item.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hijacked' })
      .expect(404);

    await request(app)
      .delete(`/api/inventory/items/${item.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  test('team members share their household\'s inventory', async () => {
    const app = await getApp();
    const { token: adminToken } = await registerAdmin();
    await createItem(adminToken, { name: 'Shared rice' });
    const { email, password } = await addMember(adminToken, 'Staff');
    const staffToken = await tokenFor(email, password);

    const res = await request(app)
      .get('/api/inventory/items')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].name, 'Shared rice');
  });
});
