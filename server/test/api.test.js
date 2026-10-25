import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s;
beforeEach(async () => (s = await startServer()));
afterEach(async () => s.close());

const create = async (body) => {
  const res = await s.api('POST', '/api/cards', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
};
const board = async () => (await s.api('GET', '/api/cards')).body;
const layout = (cards) => cards.map((c) => `${c.column}:${c.position}:${c.title}`);

test('GET /api/cards starts empty', async () => {
  const res = await s.api('GET', '/api/cards');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(res.body, []);
});

test('POST creates a card with an id and defaults, appended to its column', async () => {
  const a = await create({ title: '  First  ' });
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...a, id: undefined }, {
    id: undefined, title: 'First', description: '', assignee: '', column: 'todo', position: 0,
  });
  const b = await create({ title: 'Second', description: 'd', assignee: 'sam' });
  assert.equal(b.position, 1);
  const c = await create({ title: 'Third', column: 'done' });
  assert.equal(c.column, 'done');
  assert.equal(c.position, 0);

  const got = await s.api('GET', `/api/cards/${b.id}`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, b);
  assert.deepEqual(layout(await board()), ['todo:0:First', 'todo:1:Second', 'done:0:Third']);
});

test('POST validates and returns 400 { error: string }', async () => {
  for (const body of [{}, { title: '' }, { title: 'x'.repeat(81) }, { title: 'ok', column: 'backlog' }]) {
    const res = await s.api('POST', '/api/cards', body);
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body), ['error']);
    assert.equal(typeof res.body.error, 'string');
  }
  assert.match((await s.api('POST', '/api/cards', {})).body.error, /title is required/);
  assert.equal((await s.api('POST', '/api/cards', '{bad json')).status, 400);
  assert.equal((await s.api('POST', '/api/cards', '[1]')).status, 400);
  assert.deepEqual(await board(), []);
});

test('PATCH updates fields without touching the others', async () => {
  const a = await create({ title: 'Task', description: 'keep me', assignee: 'ana' });
  const res = await s.api('PATCH', `/api/cards/${a.id}`, { title: 'Renamed' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ...a, title: 'Renamed' });

  const bad = await s.api('PATCH', `/api/cards/${a.id}`, { title: ' ' });
  assert.equal(bad.status, 400);
  assert.equal(typeof bad.body.error, 'string');
  assert.equal((await s.api('PATCH', `/api/cards/${a.id}`, {})).status, 400);
  assert.equal((await s.api('GET', `/api/cards/${a.id}`)).body.title, 'Renamed');
});

test('PATCH { column, position } moves a card and renumbers both columns', async () => {
  const a = await create({ title: 'A' });
  const b = await create({ title: 'B' });
  const c = await create({ title: 'C' });
  const d = await create({ title: 'D', column: 'doing' });

  let res = await s.api('PATCH', `/api/cards/${a.id}`, { column: 'doing', position: 0 });
  assert.equal(res.status, 200);
  assert.equal(res.body.column, 'doing');
  assert.equal(res.body.position, 0);
  assert.deepEqual(layout(await board()), ['todo:0:B', 'todo:1:C', 'doing:0:A', 'doing:1:D']);

  // Reorder within a column.
  res = await s.api('PATCH', `/api/cards/${c.id}`, { column: 'todo', position: 0 });
  assert.deepEqual(layout(await board()), ['todo:0:C', 'todo:1:B', 'doing:0:A', 'doing:1:D']);

  // Column without position appends to the end.
  res = await s.api('PATCH', `/api/cards/${b.id}`, { column: 'doing' });
  assert.equal(res.body.position, 2);

  // Position past the end is clamped by the store.
  res = await s.api('PATCH', `/api/cards/${d.id}`, { column: 'done', position: 99 });
  assert.equal(res.body.position, 0);
  assert.deepEqual(layout(await board()), ['todo:0:C', 'doing:0:A', 'doing:1:B', 'done:0:D']);
});

test('PATCH can edit and move in one request, and validates before writing', async () => {
  const a = await create({ title: 'A' });
  const res = await s.api('PATCH', `/api/cards/${a.id}`, { title: 'A2', column: 'done', position: 0 });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'A2');
  assert.equal(res.body.column, 'done');

  for (const body of [{ column: 'review', position: 0 }, { position: -1 }, { position: '1' }, { title: 'X', column: 'nope' }]) {
    const bad = await s.api('PATCH', `/api/cards/${a.id}`, body);
    assert.equal(bad.status, 400, JSON.stringify(body));
  }
  // The rejected combined request did not apply its title edit.
  assert.equal((await s.api('GET', `/api/cards/${a.id}`)).body.title, 'A2');
});

test('DELETE removes the card and renumbers its column', async () => {
  const a = await create({ title: 'A' });
  await create({ title: 'B' });
  const res = await s.api('DELETE', `/api/cards/${a.id}`);
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.deepEqual(layout(await board()), ['todo:0:B']);
  assert.equal((await s.api('DELETE', `/api/cards/${a.id}`)).status, 404);
});

test('unknown ids and routes return 404 { error }', async () => {
  for (const [method, url, body] of [
    ['GET', '/api/cards/nope'],
    ['PATCH', '/api/cards/nope', { title: 'x' }],
    ['DELETE', '/api/cards/nope'],
    ['GET', '/api/nothing'],
  ]) {
    const res = await s.api(method, url, body);
    assert.equal(res.status, 404, `${method} ${url}`);
    assert.equal(typeof res.body.error, 'string');
  }
  assert.equal((await s.api('PUT', '/api/cards')).status, 405);
});

test('concurrent creates get distinct, contiguous positions', async () => {
  const cards = await Promise.all(Array.from({ length: 10 }, (_, i) => create({ title: `T${i}` })));
  assert.deepEqual(cards.map((c) => c.position).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual((await board()).map((c) => c.position), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
