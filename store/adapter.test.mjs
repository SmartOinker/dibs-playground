import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { createStoreAdapter } from './adapter.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'board-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'board.json');
  // These doubles test delegation, not the teammate-owned validation rules.
  const validation = {
    COLUMNS: ['todo', 'doing', 'done'],
    newId: mock.fn(() => 'generated'),
    validateCard: mock.fn((input, { partial = false } = {}) => {
      if (input.title === 'reject') {
        return { ok: false, error: 'Title rejected', errors: { title: 'Shared validator message' } };
      }
      const value = partial ? {} : { description: '', assignee: '', column: 'todo', labels: [] };
      for (const field of ['title', 'description', 'assignee', 'column', 'position', 'labels']) {
        if (input[field] !== undefined) value[field] = input[field];
      }
      return { ok: true, value };
    }),
    validateMove: mock.fn((input) => ({ ok: true, value: input })),
  };
  const open = () => createStoreAdapter({ filePath }, validation, { doing: 5 });
  return { store: open(), filePath, validation, open };
}

test('synchronous facade queues async calls and persists complete, detached cards and labels', async (t) => {
  const { store, filePath, validation, open } = await fixture(t);
  assert.equal(typeof store.then, 'undefined');
  const changes = [];
  const listener = (event) => {
    const saved = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.deepEqual(saved.find((card) => card.id === event.card.id), event.card);
    changes.push(event);
  };
  store.on('change', listener);
  const input = {
    title: 'Task', description: '  Keep spaces  ', assignee: 'Team',
    labels: [{ name: 'urgent', color: 'red' }, { name: 'bug', color: 'blue' }],
  };
  const pending = store.create(input);
  assert.ok(pending instanceof Promise);
  input.labels[0].name = 'outside';
  const card = await pending;
  assert.equal(card.id, 'generated');
  assert.equal(card.description, '  Keep spaces  ');
  assert.equal(card.labels[0].name, 'urgent');
  assert.deepEqual(await store.listLabels(), ['bug', 'urgent']);
  card.labels[0].name = 'returned mutation';
  assert.equal((await store.get(card.id)).labels[0].name, 'urgent');
  await store.update(card.id, { labels: [{ name: 'feature', color: 'green' }] });
  assert.deepEqual(validation.validateCard.mock.calls.at(-1).arguments[1], { partial: true });
  assert.equal((await store.get(card.id)).assignee, 'Team');
  assert.deepEqual(await open().listLabels(), ['feature']);
  assert.equal(changes.length, 2);
  store.off('change', listener);
  assert.equal(await store.remove(card.id), true);
  assert.deepEqual(await store.listLabels(), []);
  assert.equal(changes.length, 2);
});

test('shared validation errors survive the adapter and do not alter the file or queue', async (t) => {
  const { store, filePath, validation } = await fixture(t);
  await store.create({ id: 'one', title: 'One' });
  const before = await readFile(filePath, 'utf8');
  await assert.rejects(store.update('one', { title: 'reject' }), {
    message: 'Title rejected', code: 'VALIDATION_ERROR',
    errors: { title: 'Shared validator message' },
  });
  assert.equal(await readFile(filePath, 'utf8'), before);
  await store.move('one', 'done', 0);
  assert.deepEqual(validation.validateMove.mock.calls.at(-1).arguments, [{ column: 'done', position: 0 }]);
  assert.equal((await store.get('one')).column, 'done');
  assert.equal(await store.get('missing'), null);
  assert.equal(await store.update('missing', {}), null);
  assert.equal(await store.move('missing', 'done', 0), null);
  assert.equal(await store.remove('missing'), false);
});

test('facade exposes immutable limits and atomically rejects the sixth doing card', async (t) => {
  const { store, open } = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 9 }, (_, i) => (
    store.create({ id: `card${i}`, title: `Task ${i}`, column: 'doing' })
  )));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 5);
  for (const { reason } of results.filter((result) => result.status === 'rejected')) {
    assert.equal(reason.message, "WIP limit reached for column 'doing'");
    assert.equal(reason.code, 'VALIDATION_ERROR');
    assert.deepEqual(reason.errors, { column: 'doing column is full' });
  }
  assert.deepEqual(store.limits, { doing: 5 });
  assert.throws(() => { store.limits.doing = 6; }, TypeError);
  assert.throws(() => { store.limits = { doing: null }; }, TypeError);
  const reopened = open();
  await assert.rejects(reopened.create({ id: 'sixth', title: 'Sixth', column: 'doing' }), {
    code: 'VALIDATION_ERROR',
  });
  await store.move('card0', 'doing', 4);
  await store.update('card0', { description: 'Still allowed' });
  assert.equal((await store.get('card0')).position, 4);
});
