import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openEvents } from './helpers.js';
import { createEventHub } from '../events.js';

let s;
beforeEach(async () => (s = await startServer()));
afterEach(async () => s.close());

test('GET /api/events is an SSE stream that opens with ": connected"', async () => {
  const events = await openEvents(s.base);
  assert.equal(events.res.status, 200);
  assert.match(events.res.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(events.res.headers.get('cache-control'), 'no-cache');
  events.close();
});

test('streams one named event per change with the card as data', async () => {
  const events = await openEvents(s.base);
  const other = await openEvents(s.base);

  const created = (await s.api('POST', '/api/cards', { title: 'Live' })).body;
  assert.deepEqual(await events.next(), { event: 'card.created', data: created });
  assert.deepEqual(await other.next(), { event: 'card.created', data: created });

  const updated = (await s.api('PATCH', `/api/cards/${created.id}`, { assignee: 'kim' })).body;
  assert.deepEqual(await events.next(), { event: 'card.updated', data: updated });

  const moved = (await s.api('PATCH', `/api/cards/${created.id}`, { column: 'doing', position: 0 })).body;
  assert.deepEqual(await events.next(), { event: 'card.moved', data: moved });

  await s.api('DELETE', `/api/cards/${created.id}`);
  assert.deepEqual(await events.next(), { event: 'card.deleted', data: moved });

  events.close();
  other.close();
});

test('a combined edit + move emits card.updated then card.moved', async () => {
  const card = (await s.api('POST', '/api/cards', { title: 'Both' })).body;
  const events = await openEvents(s.base);
  const res = await s.api('PATCH', `/api/cards/${card.id}`, { title: 'Both2', column: 'done', position: 0 });
  const first = await events.next();
  const second = await events.next();
  assert.equal(first.event, 'card.updated');
  assert.equal(first.data.title, 'Both2');
  assert.deepEqual(second, { event: 'card.moved', data: res.body });
  events.close();
});

test('failed requests emit nothing', async () => {
  const events = await openEvents(s.base);
  await s.api('POST', '/api/cards', { title: '' });
  await s.api('PATCH', '/api/cards/missing', { title: 'x' });
  const card = (await s.api('POST', '/api/cards', { title: 'ok' })).body;
  assert.deepEqual(await events.next(), { event: 'card.created', data: card });
  events.close();
});

test('the hub sends ":" keepalive comments and drops closed clients', async () => {
  const hub = createEventHub({ keepaliveMs: 20 });
  const writes = [];
  const listeners = {};
  const req = { on: (ev, fn) => (listeners[ev] = fn) };
  const res = { writeHead() {}, write: (chunk) => writes.push(chunk), on() {}, end() {} };
  hub.subscribe(req, res);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(writes[0], ': connected\n\n');
  assert.ok(writes.slice(1).includes(':\n\n'));
  listeners.close();
  assert.equal(hub.size, 0);
  hub.close();
});
