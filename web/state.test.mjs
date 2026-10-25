import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardState, cardFields } from './board-state.mjs';

test('HTTP metadata loads even when newer SSE cards beat the HTTP response', async () => {
  const board = createBoardState();
  let finish;
  const pending = board.refresh(() => new Promise(resolve => { finish = resolve; }));
  board.receive([{ id: 'live', labels: [{ name: 'Bug', color: 'red' }] }]);
  finish({ columns: ['todo', 'doing', 'done'], cards: [{ id: 'stale' }], limits: { doing: 5 }, labelColors: ['red'] });
  await pending;
  assert.equal(board.state.cards[0].id, 'live');
  assert.deepEqual(board.state.limits, { doing: 5 });
  assert.deepEqual(board.state.labelColors, ['red']);
  assert.equal(board.state.loaded, true);
  // Later reads refresh metadata; older outstanding reads cannot undo them.
  const stale = board.refresh(() => new Promise(resolve => { finish = resolve; }));
  const limits = { doing: 5 };
  await board.refresh(async () => ({ columns: ['todo', 'doing', 'done'], cards: [], limits, labelColors: ['blue'] }));
  finish({ columns: [], cards: [{ id: 'stale' }], limits: { doing: 1 }, labelColors: ['red'] });
  await stale;
  assert.equal(board.state.limits, limits);
  assert.deepEqual(board.state.labelColors, ['blue']);
  assert.deepEqual(board.state.cards, []);
  const missingSettings = createBoardState();
  await assert.rejects(missingSettings.refresh(async () => ({ columns: ['todo', 'doing', 'done'], cards: [] })), /did not provide/);
  assert.equal(missingSettings.state.loaded, false);
});

test('missing, unlimited, and invalid WIP metadata cannot enable mutations', async () => {
  const board = createBoardState();
  for (const doing of [undefined, null, 0, -1, 1.5, '5']) {
    await assert.rejects(board.refresh(async () => ({
      columns: ['todo', 'doing', 'done'], cards: [], limits: { doing }, labelColors: ['red'],
    })), /did not provide/);
    assert.equal(board.state.loaded, false);
  }
  await board.refresh(async () => ({
    columns: ['todo', 'doing', 'done'], cards: [], limits: { doing: 5 }, labelColors: ['red'],
  }));
  const previous = board.state.limits;
  await assert.rejects(board.refresh(async () => ({
    columns: ['todo', 'doing', 'done'], cards: [], limits: { doing: null }, labelColors: ['blue'],
  })), /did not provide/);
  assert.equal(board.state.limits, previous);
  assert.deepEqual(board.state.labelColors, ['red']);
});

test('creation sends object labels using only API palette colors and validates trimmed title length', () => {
  const entries = Object.entries({ title: '  Ship  ', column: 'todo', labelNames: ' Bug, Release, Bug, ', labelColor: 'purple' });
  assert.deepEqual(cardFields(entries, ['purple']), {
    title: 'Ship', description: '', assignee: '', column: 'todo',
    labels: [{ name: 'Bug', color: 'purple' }, { name: 'Release', color: 'purple' }],
  });
  assert.throws(() => cardFields(entries, ['red']), error => Boolean(error.fields.labels));
  assert.throws(() => cardFields(Object.entries({ title: 'x'.repeat(81) }), []), error => Boolean(error.fields.title));
  assert.equal(cardFields(Object.entries({ title: ' '.repeat(4) + 'x'.repeat(80) }), []).title.length, 80);
  assert.deepEqual(cardFields(Object.entries({ title: 'Plain' }), []).labels, []);
});
