import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ApiError, createApi, subscribe } from './api.mjs';

test('HTTP client follows agreed board/create/move/delete contract', async t => {
  const requests = [];
  const card = { id: 'task 1', title: 'Ship', description: 'Release it', assignee: 'Sam', column: 'todo', position: 0, labels: [{ name: 'Release', color: 'blue' }] };
  const board = { columns: ['todo', 'doing', 'done'], cards: [card], limits: { doing: 5 }, labelColors: ['blue'] };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null, type: req.headers['content-type'] });
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.method === 'GET' ? board : card));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const api = createApi((path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options));
  assert.deepEqual(await api.load(), board);
  const fields = { title: 'Ship', description: 'Release it', assignee: 'Sam', column: 'todo', labels: card.labels };
  assert.deepEqual(await api.create(fields), card);
  await api.move('task 1', 'doing', 2);
  assert.equal(await api.remove('task 1'), null);
  assert.deepEqual(requests, [
    { method: 'GET', url: '/api/board', body: null, type: undefined },
    { method: 'POST', url: '/api/cards', body: fields, type: 'application/json' },
    { method: 'PATCH', url: '/api/cards/task%201', body: { column: 'doing', position: 2 }, type: 'application/json' },
    { method: 'DELETE', url: '/api/cards/task%201', body: null, type: undefined },
  ]);
});

test('server validation details survive for inline rendering', async () => {
  const api = createApi(async () => Response.json({ error: 'Invalid card', errors: { title: 'At most 80 characters', column: 'Column is full' } }, { status: 400 }));
  await assert.rejects(api.create({ title: 'x'.repeat(81) }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assert.equal(error.message, 'Invalid card');
    assert.deepEqual(error.fields, { title: 'At most 80 characters', column: 'Column is full' });
    return true;
  });
});

test('store WIP rejection relayed as HTTP 400 retains the exact inline column error', async () => {
  const body = { error: "WIP limit reached for column 'doing'", errors: { column: 'doing column is full' } };
  const api = createApi(async () => Response.json(body, { status: 400 }));
  for (const action of [() => api.create({ title: 'Incoming', column: 'doing' }), () => api.move('incoming', 'doing', 0)]) {
    await assert.rejects(action(), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, body.error);
      assert.deepEqual(error.fields, body.errors);
      return true;
    });
  }
});

test('network and malformed responses produce useful errors', async () => {
  const offline = createApi(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(offline.load(), /Could not reach the server/);
  const malformed = createApi(async () => new Response('<html>Oops</html>', { status: 502 }));
  await assert.rejects(malformed.load(), /unreadable response/);
  const missing = createApi(async () => Response.json({ error: 'Card not found' }, { status: 404 }));
  await assert.rejects(missing.remove('gone'), /Card not found/);
});

test('SSE snapshots replace state, including after reconnect, and cleanup closes the stream', () => {
  class FakeSource extends EventTarget {
    static instance;
    constructor(url) { super(); this.url = url; FakeSource.instance = this; }
    close() { this.closed = true; }
    emit(type, data) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })); }
  }
  const snapshots = [];
  const statuses = [];
  const stop = subscribe({ cards: cards => snapshots.push(cards), status: value => statuses.push(value), error: assert.fail }, FakeSource);
  const source = FakeSource.instance;
  assert.equal(source.url, '/api/events');
  const card = { id: 'a', title: 'Persisted task', description: 'Durable detail', assignee: 'Sam', column: 'todo', position: 0, labels: [{ name: 'Bug', color: 'red' }] };
  const moved = { ...card, column: 'doing' };
  source.emit('snapshot', [card]);
  source.emit('cards', [moved]);
  source.emit('error');
  assert.match(statuses.at(-1), /reconnecting/);
  source.emit('open');
  source.emit('snapshot', []);
  assert.deepEqual(snapshots, [[card], [moved], []]);
  assert.equal(statuses.at(-1), 'Live');
  stop();
  assert.equal(source.closed, true);
});
