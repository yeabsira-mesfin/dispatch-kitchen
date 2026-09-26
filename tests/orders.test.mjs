import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
const input = { customer: 'Demo guest', items: [{ meal_id: 'm1', quantity: 2 }] };
test('server sets price and retry replays exactly one order', () => {
  const store = openStore();
  try {
    const first = store.place({ ...input, total_cents: 1 }, 'same-key-01');
    const second = store.place(input, 'same-key-01');
    assert.equal(first.order.total_cents, 1798);
    assert.equal(second.replayed, true);
    assert.equal(second.order.id, first.order.id);
    assert.equal(store.orders().length, 1);
    assert.equal(store.menu().find(m => m.id === 'm1').stock, 10);
    assert.throws(() => store.place({ ...input, customer: 'Different' }, 'same-key-01'), { status: 409 });
  } finally { store.close(); }
});
test('insufficient inventory rolls back the complete order', () => {
  const store = openStore();
  try {
    assert.throws(() => store.place({ ...input, items: [...input.items, { meal_id: 'm2', quantity: 13 }] }, 'stock-key-01'), { status: 409 });
    assert.equal(store.menu().find(m => m.id === 'm1').stock, 12);
    assert.equal(store.orders().length, 0);
  } finally { store.close(); }
});
test('cancellation restores stock once and terminal states reject edits', () => {
  const store = openStore();
  try {
    const { order } = store.place(input, 'cancel-key-01');
    const cancelled = store.transition(order.id, { status: 'cancelled', version: 1 });
    assert.equal(store.menu().find(m => m.id === 'm1').stock, 12);
    assert.throws(() => store.transition(order.id, { status: 'cancelled', version: 2 }), { status: 422 });
    assert.equal(cancelled.events.length, 2);
  } finally { store.close(); }
});
test('kitchen enforces stage order and optimistic concurrency', () => {
  const store = openStore();
  try {
    const { order } = store.place(input, 'status-key-01');
    assert.throws(() => store.transition(order.id, { status: 'completed', version: 1 }), { status: 422 });
    store.transition(order.id, { status: 'preparing', version: 1 });
    assert.throws(() => store.transition(order.id, { status: 'ready', version: 1 }), { status: 409 });
    store.transition(order.id, { status: 'ready', version: 2 });
    assert.equal(store.transition(order.id, { status: 'completed', version: 3 }).events.length, 4);
  } finally { store.close(); }
});
test('rejects malformed carts without changing stock', () => {
  const store = openStore();
  try {
    for (const items of [[], [null], [{ meal_id: 'm1', quantity: 1.5 }], [input.items[0], input.items[0]]])
      assert.throws(() => store.place({ ...input, items }, 'invalid-key'), { status: 400 });
    assert.throws(() => store.place(input, ''), { status: 400 });
  } finally { store.close(); }
});
test('retry keys and inventory persist across process restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kitchen-')), file = join(directory, 'data.db');
  const first = openStore(file), original = first.place(input, 'durable-key'); first.close();
  const second = openStore(file);
  try {
    assert.equal(second.place(input, 'durable-key').order.id, original.order.id);
    assert.equal(second.menu().find(m => m.id === 'm1').stock, 10);
  } finally { second.close(); rmSync(directory, { recursive: true }); }
});
test('concurrent HTTP orders cannot oversell inventory', async () => {
  const store = openStore(), server = createApp(store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/orders`;
  try {
    const results = await Promise.all([1, 2].map(id => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `parallel-${id}` }, body: JSON.stringify({ ...input, items: [{ meal_id: 'm1', quantity: 8 }] }) })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(store.menu().find(m => m.id === 'm1').stock, 4);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
