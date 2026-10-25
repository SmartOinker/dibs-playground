import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createStore } from './index.js';
import { COLUMNS, newId } from '../shared/cards.js';

function card(fields = {}) {
  return {
    id: newId(),
    title: 'Task',
    description: '',
    assignee: '',
    column: 'todo',
    position: 0,
    ...fields,
  };
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'board-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'nested', 'board.json') };
}

function assertOrder(cards, expectedIds) {
  assert.deepEqual(cards.map(({ id }) => id), expectedIds);
  for (const column of COLUMNS) {
    const positions = cards.filter((item) => item.column === column).map((item) => item.position);
    assert.deepEqual(positions, positions.map((_, index) => index));
  }
}

test('factory and all data methods return Promises; no file means isolated memory', async () => {
  const pending = createStore();
  assert.ok(pending instanceof Promise);
  const store = await pending;
  assert.ok(store instanceof EventEmitter);
  assert.deepEqual(await store.listCards(), []);
  const input = card();
  const created = store.createCard(input);
  assert.ok(created instanceof Promise);
  await created;
  for (const result of [
    store.listCards(), store.getCard(input.id), store.updateCard(input.id, {}),
    store.moveCard(input.id, 'todo', 0), store.deleteCard('missing'), store.close(),
  ]) {
    assert.ok(result instanceof Promise);
    await result;
  }
  assert.deepEqual(await (await createStore()).listCards(), []);
  const removed = store.deleteCard(input.id);
  assert.ok(removed instanceof Promise);
  await removed;
});

test('loads a missing file as empty, saves every change and reloads on startup', async (t) => {
  const { file } = await fixture(t);
  const store = await createStore({ file });
  assert.deepEqual(await store.listCards(), []);
  const created = await store.createCard(card({ title: '  First  ', description: ' detail ', assignee: ' Ada ' }));
  assert.equal(created.title, 'First');
  assert.equal(created.description, 'detail');
  assert.equal(created.assignee, 'Ada');
  await store.updateCard(created.id, { title: 'Updated' });
  await store.moveCard(created.id, 'doing', 10);
  await store.close();
  const reopened = await createStore({ file });
  assert.deepEqual(await reopened.listCards(), [
    { ...created, title: 'Updated', column: 'doing', position: 0 },
  ]);
  await reopened.deleteCard(created.id);
  assert.deepEqual(await (await createStore({ file })).listCards(), []);
});

test('sorts columns, appends creates and renumbers moves within and between columns', async () => {
  const store = await createStore();
  const done = await store.createCard(card({ column: 'done' }));
  const a = await store.createCard(card({ title: 'a' }));
  const b = await store.createCard(card({ title: 'b' }));
  const c = await store.createCard(card({ title: 'c' }));
  assert.equal(b.position, 1);
  assert.equal(c.position, 2);
  assertOrder(await store.listCards(), [a.id, b.id, c.id, done.id]);
  assert.equal((await store.moveCard(a.id, 'todo', 2)).position, 2);
  assertOrder(await store.listCards(), [b.id, c.id, a.id, done.id]);
  await store.moveCard(a.id, 'todo', 0);
  assertOrder(await store.listCards(), [a.id, b.id, c.id, done.id]);
  await store.moveCard(b.id, 'done', 0);
  assertOrder(await store.listCards(), [a.id, c.id, b.id, done.id]);
  await store.moveCard(a.id, 'doing', 1000);
  assertOrder(await store.listCards(), [c.id, a.id, b.id, done.id]);
  assert.equal((await store.moveCard(done.id, 'done', -100)).position, 0);
  assertOrder(await store.listCards(), [c.id, a.id, done.id, b.id]);
  const removed = await store.deleteCard(done.id);
  assert.equal(removed.position, 0);
  assertOrder(await store.listCards(), [c.id, a.id, b.id]);
});

test('field updates preserve omitted fields and snapshots never expose internal cards', async () => {
  const store = await createStore();
  const input = card({ description: 'Keep', assignee: 'Ada' });
  const pending = store.createCard(input);
  input.title = 'Mutated input';
  const created = await pending;
  assert.equal(created.title, 'Task');
  created.title = 'Mutated result';
  const patch = { title: '  Changed  ' };
  const updating = store.updateCard(created.id, patch);
  patch.title = 'Mutated patch';
  const updated = await updating;
  assert.deepEqual(updated, { ...input, title: 'Changed' });
  updated.description = 'Mutated update';
  const list = await store.listCards();
  list[0].assignee = 'Mutated list';
  list.push(card());
  const fetched = await store.getCard(created.id);
  fetched.title = 'Mutated get';
  assert.deepEqual(await store.getCard(created.id), {
    ...input, title: 'Changed', description: 'Keep', assignee: 'Ada',
  });
});

test('emits one cloned event per actual change, with the deleted card before removal', async (t) => {
  const { file } = await fixture(t);
  const store = await createStore({ file });
  const events = [];
  const diskChecks = [];
  store.on('change', (event) => {
    events.push(structuredClone(event));
    diskChecks.push(fs.readFile(file, 'utf8').then(JSON.parse));
    event.card.title = 'Listener mutation';
  });
  const created = await store.createCard(card());
  assert.equal(created.title, 'Task');
  await Promise.all(diskChecks);
  await store.updateCard(created.id, { title: 'Updated' });
  await Promise.all(diskChecks);
  await store.moveCard(created.id, 'doing', 0);
  await Promise.all(diskChecks);
  const deleted = await store.deleteCard(created.id);
  await Promise.all(diskChecks);
  assert.deepEqual(events.map(({ type }) => type), [
    'card.created', 'card.updated', 'card.moved', 'card.deleted',
  ]);
  assert.deepEqual(events[3].card, deleted);
  assert.equal(events[3].card.column, 'doing');
  const disk = await Promise.all(diskChecks);
  assert.equal(disk[0].cards[0].title, 'Task');
  assert.equal(disk[1].cards[0].title, 'Updated');
  assert.equal(disk[2].cards[0].column, 'doing');
  assert.deepEqual(disk[3].cards, []);
});

test('missing ids and unchanged updates/moves do not save or emit', async () => {
  const store = await createStore();
  const created = await store.createCard(card());
  const events = [];
  store.on('change', (event) => events.push(event));
  assert.equal(await store.getCard('missing'), null);
  assert.equal(await store.updateCard('missing', { title: 'Changed' }), null);
  assert.equal(await store.moveCard('missing', 'done', 0), null);
  assert.equal(await store.deleteCard('missing'), null);
  assert.deepEqual(await store.updateCard(created.id, {}), created);
  assert.deepEqual(await store.updateCard(created.id, { title: ' Task ' }), created);
  assert.deepEqual(await store.moveCard(created.id, 'todo', 100), created);
  assert.deepEqual(events, []);
});

test('rejects invalid cards, duplicate ids, invalid patches and moves without changing board', async () => {
  const store = await createStore();
  const created = await store.createCard(card());
  const events = [];
  store.on('change', (event) => events.push(event));
  for (const input of [
    null, [], card({ id: 'bad' }), card({ title: '' }), card({ title: 'x'.repeat(81) }),
    card({ title: 1 }), card({ description: null }), card({ assignee: 42 }),
    card({ column: 'in-progress' }), card({ position: -1 }), card({ position: 0.5 }),
    card({ position: Number.MAX_SAFE_INTEGER + 1 }), created,
  ]) {
    await assert.rejects(store.createCard(input), { code: 'VALIDATION_ERROR' });
  }
  for (const fields of [null, [], { title: ' ' }, { title: 1 }, { id: newId() }, { column: 'done' }]) {
    await assert.rejects(store.updateCard(created.id, fields), { code: 'VALIDATION_ERROR' });
  }
  for (const [column, position] of [['review', 0], ['done', 0.5], ['done', NaN], ['done', Infinity]]) {
    await assert.rejects(store.moveCard(created.id, column, position), { code: 'VALIDATION_ERROR' });
  }
  assert.deepEqual(await store.listCards(), [created]);
  assert.deepEqual(events, []);
});

test('serializes concurrent mutations, recomputing stale append positions', async (t) => {
  const { file } = await fixture(t);
  const store = await createStore({ file });
  const creates = Array.from({ length: 24 }, (_, index) =>
    store.createCard(card({ title: `Card ${index}`, position: 0 })));
  const read = store.listCards();
  await store.close();
  const created = await Promise.all(creates);
  assertOrder(await read, created.map(({ id }) => id));
  assertOrder(await (await createStore({ file })).listCards(), created.map(({ id }) => id));
  await Promise.all(created.map((item) => store.moveCard(item.id, 'doing', 0)));
  assertOrder(await store.listCards(), created.map(({ id }) => id).reverse());
  await Promise.all(created.filter((_, index) => index % 2 === 0).map((item) => store.deleteCard(item.id)));
  assertOrder(await store.listCards(), created.filter((_, index) => index % 2 === 1).map(({ id }) => id).reverse());
});

test('failed persistence leaves memory and disk unchanged, emits nothing and permits retry', async (t) => {
  const { file, directory } = await fixture(t);
  const store = await createStore({ file });
  const first = await store.createCard(card());
  const events = [];
  store.on('change', (event) => events.push(event));
  const failure = Object.assign(new Error('Simulated disk failure'), { code: 'EIO' });
  const rename = t.mock.method(fs, 'rename', async () => { throw failure; });
  await assert.rejects(store.updateCard(first.id, { title: 'Lost' }), { code: 'EIO' });
  await assert.rejects(store.moveCard(first.id, 'doing', 0), { code: 'EIO' });
  await assert.rejects(store.deleteCard(first.id), { code: 'EIO' });
  await assert.rejects(store.createCard(card()), { code: 'EIO' });
  rename.mock.restore();
  assert.deepEqual(await store.listCards(), [first]);
  assert.deepEqual((JSON.parse(await fs.readFile(file, 'utf8'))).cards, [first]);
  assert.deepEqual(await fs.readdir(path.join(directory, 'nested')), ['board.json']);
  assert.deepEqual(events, []);
  assert.equal((await store.updateCard(first.id, { title: 'Recovered' })).title, 'Recovered');
});

test('rejects corrupt JSON, invalid persisted cards, duplicate ids and position gaps', async (t) => {
  const { file } = await fixture(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const first = card();
  for (const content of [
    '{broken', 'null', '[]', '{}',
    JSON.stringify({ cards: [card({ title: ' ' })] }),
    JSON.stringify({ cards: [card({ id: 'invalid' })] }),
    JSON.stringify({ cards: [first, { ...first, position: 1 }] }),
    JSON.stringify({ cards: [card({ position: 2 })] }),
  ]) {
    await fs.writeFile(file, content);
    await assert.rejects(createStore({ file }));
    assert.equal(await fs.readFile(file, 'utf8'), content);
  }
  const second = card({ position: 1 });
  await fs.writeFile(file, JSON.stringify({ cards: [second, first] }));
  assertOrder(await (await createStore({ file })).listCards(), [first.id, second.id]);
  await assert.rejects(createStore({ file: path.dirname(file) }));
});

test('rejects invalid factory options asynchronously', async () => {
  for (const options of [null, [], { file: null }, { file: '' }, { file: 123 }]) {
    const result = createStore(options);
    assert.ok(result instanceof Promise);
    await assert.rejects(result, { code: 'VALIDATION_ERROR' });
  }
});
