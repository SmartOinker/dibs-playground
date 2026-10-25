'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createFakeStore } = require('./fake-store');
const { listen, request, subscribe } = require('./helpers');

async function setup(t) {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-web-'));
  fs.writeFileSync(path.join(webDir, 'index.html'), '<h1>board</h1>');
  fs.writeFileSync(path.join(webDir, 'app.js'), 'console.log(1)');
  const store = createFakeStore();
  const server = createApp({ store, webDir });
  const base = await listen(server);
  t.after(() => {
    server.close();
    fs.rmSync(webDir, { recursive: true, force: true });
  });
  const create = async (body) => (await request(base, 'POST', '/api/cards', body)).body;
  return { base, store, create };
}

test('POST creates a card with an id, defaults and an end-of-column position', async (t) => {
  const { base, create } = await setup(t);
  const res = await request(base, 'POST', '/api/cards', { title: ' First ', assignee: 'ana' });
  assert.equal(res.status, 201);
  assert.match(res.body.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...res.body, id: undefined }, {
    id: undefined, title: 'First', description: '', assignee: 'ana', column: 'todo', position: 0,
  });
  assert.equal((await create({ title: 'Second' })).position, 1);
  assert.equal((await create({ title: 'Elsewhere', column: 'done' })).position, 0);
});

test('concurrent creates get distinct positions', async (t) => {
  const { base, create } = await setup(t);
  const cards = await Promise.all([1, 2, 3, 4].map((n) => create({ title: `c${n}` })));
  assert.deepEqual(cards.map((c) => c.position).sort(), [0, 1, 2, 3]);
  const list = (await request(base, 'GET', '/api/cards')).body;
  assert.deepEqual(list.map((c) => c.position), [0, 1, 2, 3]);
});

test('POST rejects invalid cards with 400 and per-field errors', async (t) => {
  const { base } = await setup(t);
  const missing = await request(base, 'POST', '/api/cards', { description: 'no title' });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.fields.title, 'Title is required');
  assert.equal(typeof missing.body.error, 'string');

  const long = await request(base, 'POST', '/api/cards', { title: 'x'.repeat(81), column: 'doing' });
  assert.equal(long.status, 400);
  assert.deepEqual(Object.keys(long.body.fields).sort(), ['column', 'title']);

  const bad = await request(base, 'POST', '/api/cards', '{not json');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /JSON/);
});

test('GET lists cards sorted by column order then position, and fetches one', async (t) => {
  const { base, create } = await setup(t);
  const done = await create({ title: 'd', column: 'done' });
  const b = await create({ title: 'b' });
  const p = await create({ title: 'p', column: 'in-progress' });
  const a = await create({ title: 'a', column: 'todo' });
  const list = await request(base, 'GET', '/api/cards');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((c) => c.title), ['b', 'a', 'p', 'd']);
  assert.deepEqual((await request(base, 'GET', `/api/cards/${done.id}`)).body, done);
  assert.equal((await request(base, 'GET', '/api/cards/nope')).status, 404);
  void b; void p; void a;
});

test('PATCH edits fields and leaves the rest alone', async (t) => {
  const { base, create } = await setup(t);
  const card = await create({ title: 'Old', description: 'keep' });
  const res = await request(base, 'PATCH', `/api/cards/${card.id}`, { title: 'New', assignee: 'bo' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ...card, title: 'New', assignee: 'bo' });

  const invalid = await request(base, 'PATCH', `/api/cards/${card.id}`, { title: '' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.fields.title, 'Title is required');
  assert.equal((await request(base, 'PATCH', '/api/cards/missing', { title: 'x' })).status, 404);
});

test('PATCH with { column, position } moves a card and reindexes both columns', async (t) => {
  const { base, create } = await setup(t);
  const [a, b, c] = [await create({ title: 'a' }), await create({ title: 'b' }), await create({ title: 'c' })];
  const x = await create({ title: 'x', column: 'in-progress' });

  const moved = await request(base, 'PATCH', `/api/cards/${a.id}`, { column: 'in-progress', position: 0 });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.column, 'in-progress');
  assert.equal(moved.body.position, 0);

  const list = (await request(base, 'GET', '/api/cards')).body;
  const where = Object.fromEntries(list.map((card) => [card.title, `${card.column}:${card.position}`]));
  assert.deepEqual(where, { b: 'todo:0', c: 'todo:1', a: 'in-progress:0', x: 'in-progress:1' });

  // Reorder within a column, and move + edit in one request.
  await request(base, 'PATCH', `/api/cards/${c.id}`, { column: 'todo', position: 0 });
  const both = await request(base, 'PATCH', `/api/cards/${b.id}`, { title: 'B', column: 'done', position: 0 });
  assert.deepEqual([both.body.title, both.body.column, both.body.position], ['B', 'done', 0]);

  const bad = await request(base, 'PATCH', `/api/cards/${x.id}`, { column: 'doing', position: -2 });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.fields).sort(), ['column', 'position']);
});

test('DELETE removes a card with 204', async (t) => {
  const { base, create } = await setup(t);
  const card = await create({ title: 'gone' });
  const res = await request(base, 'DELETE', `/api/cards/${card.id}`);
  assert.equal(res.status, 204);
  assert.equal(res.text, '');
  assert.equal((await request(base, 'GET', `/api/cards/${card.id}`)).status, 404);
  assert.equal((await request(base, 'DELETE', `/api/cards/${card.id}`)).status, 404);
});

test('unknown API routes and methods get JSON errors', async (t) => {
  const { base } = await setup(t);
  assert.equal((await request(base, 'GET', '/api/nope')).status, 404);
  assert.equal((await request(base, 'PUT', '/api/cards')).status, 405);
  assert.equal((await request(base, 'POST', '/api/cards/x/move', { to: 'done' })).status, 404);
});

test('/api/events streams one named event per change with the card as data', async (t) => {
  const { base, create } = await setup(t);
  const stream = await subscribe(base);
  t.after(() => stream.close());
  assert.equal(stream.res.statusCode, 200);
  assert.match(stream.res.headers['content-type'], /^text\/event-stream/);

  const card = await create({ title: 'live' });
  await request(base, 'PATCH', `/api/cards/${card.id}`, { assignee: 'cy' });
  await request(base, 'PATCH', `/api/cards/${card.id}`, { column: 'done', position: 0 });
  await request(base, 'DELETE', `/api/cards/${card.id}`);

  const events = await stream.next(4);
  assert.deepEqual(events.map((e) => e.event), ['card.created', 'card.updated', 'card.moved', 'card.deleted']);
  assert.deepEqual(events[0].data, card);
  assert.equal(events[1].data.assignee, 'cy');
  assert.deepEqual([events[2].data.column, events[2].data.position], ['done', 0]);
  assert.equal(events[3].data.id, card.id);
});

test('SSE sends heartbeat comments', async (t) => {
  const store = createFakeStore();
  const server = createApp({ store, heartbeatMs: 20 });
  const base = await listen(server);
  t.after(() => server.close());
  const stream = await subscribe(base);
  t.after(() => stream.close());
  const text = await new Promise((resolve) => {
    let seen = '';
    stream.res.on('data', (chunk) => {
      seen += chunk;
      if (seen.includes(': ping')) resolve(seen);
    });
  });
  assert.match(text, /: ping\n\n/);
});

test('serves web/ at / and shared/ at /shared/, without escaping either', async (t) => {
  const { base } = await setup(t);
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.equal(await index.text(), '<h1>board</h1>');

  const js = await fetch(`${base}/app.js`);
  assert.match(js.headers.get('content-type'), /javascript/);

  const shared = await fetch(`${base}/shared/cards.js`);
  assert.equal(shared.status, 200);
  assert.match(await shared.text(), /validateCard/);

  assert.equal((await fetch(`${base}/missing.css`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/..%2f..%2fserver/app.js`)).status, 404);
});
