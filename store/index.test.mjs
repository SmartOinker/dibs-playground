import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('public store integrates with the real shared validator', {
  skip: !existsSync(new URL('../shared/cards.js', import.meta.url))
    && 'Teammate-owned shared/cards.js has not been delivered',
}, async (t) => {
  const { default: createStore, createStore: named } = await import('./index.js');
  assert.equal(createStore, named);
  const directory = await mkdtemp(join(tmpdir(), 'board-public-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'board.json');
  const store = createStore({ filePath });
  const card = await store.create({
    title: '  Real task  ', description: 'Details', assignee: 'Team',
    labels: [{ name: 'bug', color: 'red' }],
  });
  assert.equal(card.title, 'Real task');
  assert.deepEqual(card.labels, [{ name: 'bug', color: 'red' }]);
  assert.deepEqual(await store.listLabels(), ['bug']);
  const reopened = createStore({ filePath });
  assert.deepEqual(await reopened.get(card.id), card);
  await assert.rejects(store.create({ title: 'x'.repeat(81) }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.update(card.id, { labels: [{ name: 'bug', color: 'invalid' }] }), {
    code: 'VALIDATION_ERROR',
  });
  await assert.rejects(store.create({ title: 'Invalid labels', labels: ['bug'] }), {
    code: 'VALIDATION_ERROR',
  });
});
