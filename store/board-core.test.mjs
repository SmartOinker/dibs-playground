import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openBoard } from './board-core.mjs';

// These callbacks only exercise the private adapter boundary, not shared validation.
function normalize(input, { partial = false } = {}) {
  if (!input || input.title === null) throw new Error('Rejected by validator');
  const result = partial ? {} : { title: '', description: '', assignee: '', column: 'a', labels: [] };
  for (const field of ['title', 'description', 'assignee', 'column', 'position', 'labels']) {
    if (input[field] !== undefined) result[field] = input[field];
  }
  return result;
}
function validateMove(input) {
  if (!['a', 'b'].includes(input.column) || !Number.isInteger(input.position) || input.position < 0) {
    throw new Error('Rejected move');
  }
  return input;
}
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'board-core-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'board.json');
  let generated = 0;
  const options = {
    filePath, columns: ['a', 'b'], normalize, validateMove, newId: () => `generated-${++generated}`,
    ...overrides,
  };
  return { directory, filePath, options, board: await openBoard(options) };
}

test('CRUD persists complete cards, reloads, and returns detached snapshots', async (t) => {
  const { board, filePath, options } = await fixture(t);
  const input = { title: 'One', labels: [{ name: 'bug', color: 'red' }] };
  const created = await board.create(input);
  input.labels[0].name = 'changed outside';
  created.labels[0].name = 'changed result';
  assert.equal((await board.get(created.id)).labels[0].name, 'bug');
  const changed = await board.update(created.id, { description: 'Details', assignee: 'Team' });
  assert.equal(changed.title, 'One');
  assert.equal(changed.description, 'Details');
  assert.deepEqual(await (await openBoard(options)).list(), await board.list());
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), await board.list());
  assert.equal(await board.remove(created.id), true);
  assert.deepEqual(await board.list(), []);
});

test('moves use final indices, clamp append, and resequence both columns and deletion', async (t) => {
  const { board } = await fixture(t);
  for (const id of ['one', 'two', 'three']) await board.create({ id, title: id });
  await board.move('one', 'a', 2);
  assert.deepEqual((await board.list()).map((card) => [card.id, card.position]), [
    ['two', 0], ['three', 1], ['one', 2],
  ]);
  await board.move('one', 'a', 0);
  await board.move('two', 'b', 99);
  assert.deepEqual((await board.list()).map((card) => [card.id, card.column, card.position]), [
    ['one', 'a', 0], ['three', 'a', 1], ['two', 'b', 0],
  ]);
  await board.remove('one');
  assert.equal((await board.get('three')).position, 0);
});

test('concurrent mutations serialize; a rejected operation does not poison the queue', async (t) => {
  const { board, options } = await fixture(t);
  const creates = Array.from({ length: 12 }, (_, i) => board.create({ id: `c${i}`, title: `Card ${i}` }));
  assert.ok(creates.every((value) => value instanceof Promise));
  await Promise.all(creates);
  assert.deepEqual((await board.list()).map((card) => card.position), Array.from({ length: 12 }, (_, i) => i));
  await assert.rejects(board.create({ id: 'c0', title: 'Duplicate' }), { code: 'VALIDATION_ERROR' });
  await board.update('c0', { title: 'Recovered' });
  assert.deepEqual(await (await openBoard(options)).list(), await board.list());
});

test('events follow durable changes; no-ops, missing ids and validation failures emit nothing', async (t) => {
  const { board, filePath } = await fixture(t);
  const changes = [];
  const listener = (event) => {
    const saved = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(saved.some((card) => card.id === event.card.id), event.type !== 'card.deleted');
    changes.push(event.type);
    event.card.title = 'Mutated event';
  };
  board.on('change', listener);
  await board.create({ id: 'one', title: 'One' });
  await board.update('one', {});
  await board.move('one', 'a', 0);
  assert.equal((await board.get('one')).title, 'One');
  assert.equal(await board.get('missing'), null);
  assert.equal(await board.update('missing', {}), null);
  assert.equal(await board.move('missing', 'b', 0), null);
  assert.equal(await board.remove('missing'), false);
  await assert.rejects(board.create({ title: null }));
  await assert.rejects(board.move('one', 'invalid', -1));
  await board.update('one', { title: 'Edited' });
  await board.move('one', 'b', 0);
  await board.remove('one');
  assert.deepEqual(changes, ['card.created', 'card.updated', 'card.moved', 'card.deleted']);
  board.off('change', listener);
  await board.create({ title: 'Unobserved' });
  assert.equal(changes.length, 4);
});

test('failed writes leave memory and events unchanged, and subsequent writes recover', async (t) => {
  const { board, filePath, directory } = await fixture(t);
  await board.create({ id: 'one', title: 'Before' });
  const backup = join(directory, 'backup.json');
  await rename(filePath, backup);
  await mkdir(filePath);
  let events = 0;
  board.on('change', () => events++);
  await assert.rejects(board.update('one', { title: 'Not saved' }));
  assert.equal((await board.get('one')).title, 'Before');
  assert.equal(events, 0);
  await rm(filePath, { recursive: true });
  await rename(backup, filePath);
  await board.update('one', { title: 'Saved' });
  assert.equal(events, 1);
});

test('corrupt JSON and invalid persisted invariants are rejected without overwriting', async (t) => {
  const { options, filePath } = await fixture(t);
  await writeFile(filePath, '{broken');
  await assert.rejects(openBoard(options), SyntaxError);
  assert.equal(await readFile(filePath, 'utf8'), '{broken');
  for (const invalid of [
    {},
    [{ id: 'x', title: 'X', column: 'a', position: 1 }],
    [{ id: 'x', title: 'X', column: 'a', position: 0 }, { id: 'x', title: 'X', column: 'b', position: 0 }],
  ]) {
    await writeFile(filePath, JSON.stringify(invalid));
    await assert.rejects(openBoard(options), { code: 'VALIDATION_ERROR' });
  }
});

test('capacity checks serialize with writes, reject incoming moves, and allow reorder at capacity', async (t) => {
  const { board, filePath, options } = await fixture(t, { limits: { b: 5 } });
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => (
    board.create({ id: `b${i}`, title: `Card ${i}`, column: 'b' })
  )));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 5);
  for (const result of results.filter((item) => item.status === 'rejected')) {
    assert.equal(result.reason.code, 'VALIDATION_ERROR');
    assert.equal(result.reason.message, "WIP limit reached for column 'b'");
    assert.deepEqual(result.reason.errors, { column: 'b column is full' });
  }
  await board.create({ id: 'outside', title: 'Outside' });
  let changes = 0;
  board.on('change', () => changes++);
  const before = await readFile(filePath, 'utf8');
  await assert.rejects(board.move('outside', 'b', 0), { code: 'VALIDATION_ERROR' });
  assert.equal(await readFile(filePath, 'utf8'), before);
  assert.equal(changes, 0);
  await board.move('b0', 'b', 4);
  await board.update('b0', { description: 'Allowed at capacity' });
  await board.move('b0', 'a', 0);
  const moves = await Promise.allSettled([
    board.move('b0', 'b', 0),
    board.move('outside', 'b', 0),
  ]);
  assert.equal(moves.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await board.list()).filter((card) => card.column === 'b').length, 5);
  assert.deepEqual(await (await openBoard(options)).list(), await board.list());
  assert.throws(() => { board.limits.b = 99; }, TypeError);
  assert.throws(() => { board.limits = {}; }, TypeError);
});

test('opening an over-capacity board fails without rewriting it', async (t) => {
  const { filePath, options } = await fixture(t);
  const saved = JSON.stringify(Array.from({ length: 6 }, (_, position) => ({
    id: `b${position}`, title: 'Existing', column: 'b', position,
  })));
  await writeFile(filePath, saved);
  await assert.rejects(openBoard({ ...options, limits: { b: 5 } }), { code: 'VALIDATION_ERROR' });
  assert.equal(await readFile(filePath, 'utf8'), saved);
});

test('known labels are derived from persisted cards and track replacements and deletion', async (t) => {
  const { board, filePath, options } = await fixture(t, {
    labelNames: (card) => card.labels ?? [],
  });
  await board.create({ id: 'one', title: 'One', labels: ['bug', 'urgent', 'bug'] });
  await board.create({ id: 'two', title: 'Two', labels: ['feature'] });
  assert.deepEqual(await board.listLabels(), ['bug', 'feature', 'urgent']);
  const snapshot = await board.listLabels();
  snapshot.push('outside');
  assert.deepEqual(await board.listLabels(), ['bug', 'feature', 'urgent']);
  await board.update('one', { labels: [] });
  await board.remove('two');
  assert.deepEqual(await board.listLabels(), []);
  const reopened = await openBoard(options);
  assert.deepEqual(await reopened.listLabels(), await board.listLabels());
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), await board.list());
});

test('legacy card arrays gain a registry without losing optional metadata', async (t) => {
  const { filePath, options } = await fixture(t, { labelNames: (card) => card.labels ?? [] });
  await writeFile(filePath, JSON.stringify([
    { id: 'old', title: 'Old', column: 'a', position: 0 },
    { id: 'full', title: 'Full', description: '  Keep spacing  ', assignee: 'Team', column: 'b', position: 0, labels: ['bug'] },
  ]));
  const board = await openBoard(options);
  assert.deepEqual((await board.get('old')).labels, []);
  assert.deepEqual(await board.listLabels(), ['bug']);
  await board.update('old', { description: 'Added', assignee: 'Someone', labels: ['urgent'] });
  const reopened = await openBoard(options);
  assert.equal((await reopened.get('full')).description, '  Keep spacing  ');
  assert.equal((await reopened.get('old')).assignee, 'Someone');
  assert.deepEqual(await reopened.listLabels(), ['bug', 'urgent']);
});

test('create inserts at the requested final position or appends past the end', async (t) => {
  const { board } = await fixture(t);
  await board.create({ id: 'one', title: 'One' });
  await board.create({ id: 'two', title: 'Two', position: 0 });
  await board.create({ id: 'three', title: 'Three', position: 99 });
  assert.deepEqual((await board.list()).map((card) => [card.id, card.position]), [
    ['two', 0], ['one', 1], ['three', 2],
  ]);
});
