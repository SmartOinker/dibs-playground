'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const createStore = require('./index');
const { COLUMNS, newId } = require('../shared/cards');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'board-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'nested', 'board.json');
  return { directory, filePath, store: await createStore({ filePath }) };
}

function input(title, column = 'todo', position = 0) {
  return { id: newId(), title, description: '', assignee: '', column, position };
}

function columnIds(board, column) {
  return board.cards.filter((card) => card.column === column)
    .sort((left, right) => left.position - right.position).map((card) => card.id);
}

function assertPositions(board) {
  for (const column of COLUMNS) {
    const positions = board.cards.filter((card) => card.column === column)
      .map((card) => card.position).sort((left, right) => left - right);
    assert.deepEqual(positions, positions.map((_, index) => index));
  }
}

test('default export is an async factory that creates and loads its JSON file', async (t) => {
  const { filePath, store } = await fixture(t);
  assert.ok(store instanceof EventEmitter);
  assert.deepEqual(await store.getBoard(), { cards: [] });
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), { cards: [] });
  const card = await store.createCard(input('Initial card'));
  const reopened = await createStore({ filePath });
  assert.deepEqual(await reopened.getBoard(), { cards: [card] });
});

test('all data operations return Promises, including invalid calls', async (t) => {
  const { store } = await fixture(t);
  for (const promise of [
    createStore(), createStore({ filePath: '' }), store.getBoard(),
    store.createCard(null), store.updateCard('missing', null),
    store.moveCard('missing', null), store.deleteCard('missing'),
  ]) {
    assert.ok(promise instanceof Promise);
    await promise.catch(() => {});
  }
});

test('CRUD emits exactly {type,card} after the corresponding file commit', async (t) => {
  const { filePath, store } = await fixture(t);
  const events = [];
  store.on('change', (event) => {
    const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
    if (event.type === 'card.deleted') {
      assert.equal(persisted.cards.some((card) => card.id === event.card.id), false);
    } else {
      assert.deepEqual(persisted.cards.find((card) => card.id === event.card.id), event.card);
    }
    assert.deepEqual(Object.keys(event).sort(), ['card', 'type']);
    events.push(event);
  });
  const created = await store.createCard({
    ...input('  Plan  '), description: '  Details  ', assignee: '  Ada  ',
  });
  assert.equal(created.title, 'Plan');
  assert.equal(created.description, 'Details');
  assert.equal(created.assignee, 'Ada');
  const updated = await store.updateCard(created.id, { title: 'Done planning' });
  assert.equal(updated.description, 'Details');
  const moved = await store.moveCard(created.id, { column: 'in-progress', position: 0 });
  const deleted = await store.deleteCard(created.id);
  assert.deepEqual(deleted, moved);
  assert.deepEqual(events, [
    { type: 'card.created', card: created },
    { type: 'card.updated', card: updated },
    { type: 'card.moved', card: moved },
    { type: 'card.deleted', card: deleted },
  ]);
  assert.deepEqual(await store.getBoard(), { cards: [] });
});

test('creation inserts at its index and clamps beyond the end', async (t) => {
  const { store } = await fixture(t);
  const a = await store.createCard(input('A'));
  const c = await store.createCard(input('C', 'todo', 100));
  const b = await store.createCard(input('B', 'todo', 1));
  const board = await store.getBoard();
  assert.deepEqual(columnIds(board, 'todo'), [a.id, b.id, c.id]);
  assert.equal(c.position, 1);
  assertPositions(board);
});

test('move reorders in both directions and across columns, then delete fills gaps', async (t) => {
  const { store } = await fixture(t);
  const cards = [];
  for (let index = 0; index < 4; index += 1) {
    cards.push(await store.createCard(input(String(index), 'todo', index)));
  }
  const [a, b, c, d] = cards;
  await store.moveCard(a.id, { column: 'todo', position: 2 });
  assert.deepEqual(columnIds(await store.getBoard(), 'todo'), [b.id, c.id, a.id, d.id]);
  await store.moveCard(d.id, { column: 'todo', position: 0 });
  assert.deepEqual(columnIds(await store.getBoard(), 'todo'), [d.id, b.id, c.id, a.id]);
  await store.moveCard(b.id, { column: 'done', position: 50 });
  await store.moveCard(a.id, { column: 'done', position: 0 });
  assert.deepEqual(columnIds(await store.getBoard(), 'done'), [a.id, b.id]);
  assert.deepEqual(columnIds(await store.getBoard(), 'todo'), [d.id, c.id]);
  await store.deleteCard(d.id);
  await store.deleteCard(a.id);
  const board = await store.getBoard();
  assert.deepEqual(columnIds(board, 'todo'), [c.id]);
  assert.deepEqual(columnIds(board, 'done'), [b.id]);
  assertPositions(board);
});

test('bad cards never change state, disk, or events', async (t) => {
  const { store, filePath } = await fixture(t);
  const original = await fs.readFile(filePath, 'utf8');
  let changes = 0;
  store.on('change', () => { changes += 1; });
  const invalid = [
    { title: '' }, { title: ' '.repeat(10) }, { title: 'x'.repeat(81) },
    { title: 42 }, { description: 42 }, { assignee: false },
    { column: 'doing' }, { column: 'backlog' },
    { position: -1 }, { position: 1.5 }, { position: Number.MAX_VALUE },
    { position: undefined }, { id: '' }, { id: undefined },
  ];
  for (const patch of invalid) {
    await assert.rejects(store.createCard({ ...input('Valid'), ...patch }), { statusCode: 400 });
  }
  for (const value of [undefined, null, [], 'card']) {
    await assert.rejects(store.createCard(value), { statusCode: 400 });
  }
  assert.deepEqual(await store.getBoard(), { cards: [] });
  assert.equal(await fs.readFile(filePath, 'utf8'), original);
  assert.equal(changes, 0);
});

test('duplicate ids and invalid updates/moves reject with 400 and recover', async (t) => {
  const { store } = await fixture(t);
  const card = await store.createCard(input('Keep me'));
  await assert.rejects(store.createCard({ ...card }), { statusCode: 400 });
  for (const patch of [
    { title: '' }, { title: 'x'.repeat(81) }, { id: newId() },
    { position: 0 }, { column: 'done' }, { unknown: true },
  ]) {
    await assert.rejects(store.updateCard(card.id, patch), { statusCode: 400 });
  }
  for (const destination of [
    {}, { column: 'doing', position: 0 }, { column: 'done', position: -1 },
    { column: 'done', position: 0.1 }, { column: 'done', position: '0' },
  ]) {
    await assert.rejects(store.moveCard(card.id, destination), { statusCode: 400 });
  }
  assert.deepEqual(await store.getBoard(), { cards: [card] });
  assert.equal((await store.updateCard(card.id, { title: 'Recovered' })).title, 'Recovered');
});

test('missing cards return statusCode 404 for every mutation', async (t) => {
  const { store } = await fixture(t);
  for (const promise of [
    store.updateCard('missing', { title: 'Missing' }),
    store.moveCard('missing', { column: 'done', position: 0 }),
    store.deleteCard('missing'),
  ]) {
    await assert.rejects(promise, { statusCode: 404, message: 'Not found' });
  }
});

test('snapshots, inputs, return values and event objects cannot mutate stored cards', async (t) => {
  const { store } = await fixture(t);
  store.on('change', (event) => { event.card.title = 'Listener mutation'; });
  const draft = input('Original');
  const creation = store.createCard(draft);
  draft.title = 'Caller mutation';
  const created = await creation;
  assert.equal(created.title, 'Original');
  created.title = 'Return mutation';
  const snapshot = await store.getBoard();
  snapshot.cards[0].title = 'Snapshot mutation';
  snapshot.cards.length = 0;
  const patch = { title: 'Updated' };
  const updating = store.updateCard(created.id, patch);
  patch.title = 'Late mutation';
  await updating;
  assert.equal((await store.getBoard()).cards[0].title, 'Updated');
});

test('concurrent creates, updates, moves and deletes keep disk and memory consistent', async (t) => {
  const { store, filePath } = await fixture(t);
  const created = await Promise.all(Array.from({ length: 16 }, (_, index) =>
    store.createCard(input(`Card ${index}`, 'todo', index))));
  await Promise.all(created.map((card, index) =>
    store.updateCard(card.id, { assignee: `Member ${index}` })));
  await Promise.all(created.filter((_, index) => index % 2 === 0)
    .map((card) => store.moveCard(card.id, { column: 'in-progress', position: 0 })));
  await Promise.all(created.filter((_, index) => index % 3 === 0)
    .map((card) => store.deleteCard(card.id)));
  const board = await store.getBoard();
  assertPositions(board);
  assert.equal(board.cards.length, 10);
  assert.deepEqual(board, JSON.parse(await fs.readFile(filePath, 'utf8')));
  assert.deepEqual(board, await (await createStore({ filePath })).getBoard());
});

test('a failed disk replacement publishes no state or event and does not poison the queue', async (t) => {
  const { store, filePath } = await fixture(t);
  const original = await store.createCard(input('Original'));
  const before = await fs.readFile(filePath, 'utf8');
  let changes = 0;
  store.on('change', () => { changes += 1; });
  const replacement = t.mock.method(fs, 'rename', async () => {
    throw Object.assign(new Error('Disk failure'), { code: 'EIO' });
  });
  await assert.rejects(store.updateCard(original.id, { title: 'Failed' }), { code: 'EIO' });
  assert.deepEqual(await store.getBoard(), { cards: [original] });
  assert.equal(await fs.readFile(filePath, 'utf8'), before);
  assert.equal(changes, 0);
  replacement.mock.restore();
  await store.updateCard(original.id, { title: 'Recovered' });
  assert.equal(changes, 1);
});

test('startup refuses damaged or invalid boards without overwriting the file', async (t) => {
  const { filePath } = await fixture(t);
  const card = input('Saved');
  const sources = [
    '{"cards":', 'null', '[]', '{}', '{"cards":{}}',
    JSON.stringify({ cards: [{ ...card, title: '' }] }),
    JSON.stringify({ cards: [{ ...card, column: 'doing' }] }),
    JSON.stringify({ cards: [{ ...card, position: 1 }] }),
    JSON.stringify({ cards: [card, { ...card, position: 1 }] }),
  ];
  for (const source of sources) {
    await fs.writeFile(filePath, source);
    await assert.rejects(createStore({ filePath }));
    assert.equal(await fs.readFile(filePath, 'utf8'), source);
  }
});
