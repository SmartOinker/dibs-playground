import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, subscribe, CHANGE_EVENTS, createRefreshQueue } from '../api.mjs';
import { cardsInColumn, dropPosition, initials } from '../board-model.mjs';

test('API uses agreed routes, JSON bodies, PATCH moves, and empty DELETE responses', async () => {
  const calls = [];
  const api = createApi(async (path, options) => {
    calls.push({ path, ...options });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(options.method === 'GET' ? [] : { id: 'a' });
  });
  assert.deepEqual(await api.list(), []);
  await api.create({ title: 'A', column: 'todo' });
  await api.update('a/b', { assignee: 'Jo' });
  await api.move('a/b', 'in-progress', 2);
  assert.equal(await api.remove('a/b'), null);
  assert.deepEqual(calls.map(call => [call.path, call.method]), [
    ['/api/cards', 'GET'], ['/api/cards', 'POST'], ['/api/cards/a%2Fb', 'PATCH'],
    ['/api/cards/a%2Fb', 'PATCH'], ['/api/cards/a%2Fb', 'DELETE'],
  ]);
  assert.deepEqual(JSON.parse(calls[3].body), { column: 'in-progress', position: 2 });
  assert.equal(calls[1].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].cache, 'no-store');
});

test('server field errors and general errors survive unchanged', async () => {
  const api = createApi(async () => Response.json({ error: 'Title required', fields: { title: 'Enter a title' } }, { status: 400 }));
  await assert.rejects(api.create({}), error => error instanceof ApiError && error.status === 400 && error.message === 'Title required' && error.fields.title === 'Enter a title');
  const missing = createApi(async () => Response.json({ error: 'Not found' }, { status: 404 }));
  await assert.rejects(missing.remove('gone'), error => error.status === 404 && error.message === 'Not found');
});

test('offline, unreadable and invalid-board responses produce useful errors', async () => {
  await assert.rejects(createApi(async () => { throw new Error('offline'); }).list(), /Cannot reach/);
  await assert.rejects(createApi(async () => new Response('<html>oops</html>', { status: 502 })).list(), /502/);
  await assert.rejects(createApi(async () => Response.json({ cards: [] })).list(), /invalid board/);
});

test('move positions exclude the source for downward, upward, cross-column and empty drops', () => {
  const cards = [
    { id: 'c', column: 'todo', position: 2 }, { id: 'a', column: 'todo', position: 0 },
    { id: 'b', column: 'todo', position: 1 }, { id: 'x', column: 'done', position: 0 },
  ];
  assert.deepEqual(cardsInColumn(cards, 'todo').map(card => card.id), ['a', 'b', 'c']);
  assert.equal(dropPosition(cards, 'todo', 'a', 'c'), 1);
  assert.equal(dropPosition(cards, 'todo', 'c', 'a'), 0);
  assert.equal(dropPosition(cards, 'todo', 'a'), 2);
  assert.equal(dropPosition(cards, 'done', 'a', 'x'), 0);
  assert.equal(dropPosition(cards, 'in-progress', 'a'), 0);
  assert.equal(cards[0].id, 'c', 'does not mutate server state');
  assert.equal(initials('  Alex Morgan '), 'AM');
});

test('SSE listens to every agreed event and refetches on each reconnect', () => {
  let source;
  class Source extends EventTarget {
    constructor(url) { super(); this.url = url; source = this; }
    close() { this.closed = true; }
  }
  let count = 0;
  const states = [];
  const close = subscribe(() => count++, state => states.push(state), Source);
  assert.equal(source.url, '/api/events');
  source.dispatchEvent(new Event('open'));
  for (const name of CHANGE_EVENTS) source.dispatchEvent(new Event(name));
  source.dispatchEvent(new Event('error'));
  source.dispatchEvent(new Event('open'));
  assert.equal(count, 6);
  assert.deepEqual(states, ['live', 'offline', 'live']);
  close();
  assert.equal(source.closed, true);
});

test('refresh queue serializes requests and refetches changes during an in-flight GET', async () => {
  const resolvers = [];
  let requests = 0;
  const refresh = createRefreshQueue(() => { requests++; return new Promise(resolve => resolvers.push(resolve)); });
  const first = refresh();
  const second = refresh();
  refresh();
  assert.equal(first, second);
  assert.equal(requests, 1);
  resolvers.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);
  resolvers.shift()();
  await first;
});

test('refresh queue recovers after a failed request', async () => {
  let attempts = 0;
  const refresh = createRefreshQueue(async () => { if (++attempts === 1) throw new Error('offline'); });
  await assert.rejects(refresh(), /offline/);
  await refresh();
  assert.equal(attempts, 2);
});
