import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, subscribe, COLUMN_DEFS, CHANGE_EVENTS } from '../api.mjs';

test('API adapter follows accepted board.api v1 for every mutation', async () => {
  const calls = [];
  const api = createApi(async (path, options) => {
    calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 'a' });
  });
  await api.create({ title: 'A', description: '', assignee: '', column: 'todo' });
  await api.update('a/b', { title: 'B' });
  await api.move('a/b', 'doing', 2);
  await api.remove('a/b');
  assert.deepEqual(calls, [
    { path: '/api/cards', method: 'POST', body: { title: 'A', description: '', assignee: '', column: 'todo' } },
    { path: '/api/cards/a%2Fb', method: 'PATCH', body: { title: 'B' } },
    { path: '/api/cards/a%2Fb', method: 'PATCH', body: { column: 'doing', position: 2 } },
    { path: '/api/cards/a%2Fb', method: 'DELETE', body: undefined },
  ]);
  assert.deepEqual(COLUMN_DEFS.map(column => column.id), ['todo', 'doing', 'done']);
});

test('list accepts bare cards and rejects malformed or duplicate snapshots', async () => {
  const card = { id: 'a', title: 'A', description: '', assignee: '', column: 'todo', position: 0 };
  let data = [card];
  const api = createApi(async path => { assert.equal(path, '/api/cards'); return Response.json(data); });
  assert.deepEqual(await api.list(), [card]);
  for (const invalid of [{ cards: [card] }, [card, card], [{ ...card, column: 'backlog' }], [{ ...card, position: -1 }], [null]]) {
    data = invalid;
    await assert.rejects(api.list(), /invalid board/);
  }
});

test('validation and not-found responses preserve the literal server error', async () => {
  for (const status of [400, 404]) {
    const api = createApi(async () => Response.json({ error: 'title: Please add a title. <b>Untrusted</b>' }, { status }));
    await assert.rejects(api.create({ title: '' }), error => error.status === status && error.message === 'title: Please add a title. <b>Untrusted</b>');
  }
});

test('SSE listens to all agreed change events, open, error and closes on cleanup', () => {
  let instance;
  class FakeEventSource {
    listeners = {};
    constructor(path) { assert.equal(path, '/api/events'); instance = this; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    close() { this.closed = true; }
  }
  let changes = 0, opens = 0, disconnects = 0;
  const stop = subscribe({ change: () => changes++, connected: () => opens++, disconnected: () => disconnects++ }, FakeEventSource);
  instance.listeners.open();
  for (const name of CHANGE_EVENTS) instance.listeners[name]({ data: '{}' });
  instance.listeners.error();
  assert.equal(changes, 4);
  assert.equal(opens, 1);
  assert.equal(disconnects, 1);
  stop();
  assert.equal(instance.closed, true);
});
