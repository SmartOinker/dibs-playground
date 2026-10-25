import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedCards, dropIndex, initials, createRequester, ApiError, createRefreshQueue } from '../board.mjs';

const cards = [
  { id: 'b', column: 'one', position: 1 },
  { id: 'x', column: 'two', position: 0 },
  { id: 'a', column: 'one', position: 0 },
  { id: 'c', column: 'one', position: 2 },
];

test('column ordering does not mutate the server snapshot', () => {
  assert.deepEqual(orderedCards(cards, 'one').map(card => card.id), ['a', 'b', 'c']);
  assert.equal(cards[0].id, 'b');
});

test('drag indices use destination order after removal, within and between columns', () => {
  assert.equal(dropIndex(cards, 'one', 'a', 'c'), 1);
  assert.equal(dropIndex(cards, 'one', 'c', 'a'), 0);
  assert.equal(dropIndex(cards, 'one', 'a'), 2);
  assert.equal(dropIndex(cards, 'one', 'x', 'b'), 1);
  assert.equal(dropIndex(cards, 'empty', 'a'), 0);
  assert.equal(dropIndex(cards, 'one', 'b', 'c'), 1);
});

test('assignee initials handle whitespace, blank input and Unicode', () => {
  assert.equal(initials('  Ada  Lovelace '), 'AL');
  assert.equal(initials(''), '');
  assert.equal(initials('🌱 Gardener'), '🌱G');
});

test('JSON requests preserve exact values and support empty deletion responses', async () => {
  const calls = [];
  const request = createRequester(async (...args) => {
    calls.push(args);
    return new Response(null, { status: 204 });
  });
  assert.equal(await request('/cards/a', 'DELETE'), undefined);
  await request('/cards', 'POST', { title: '<script> & things', description: 'A\nB' });
  assert.equal(calls[0][1].body, undefined);
  assert.deepEqual(JSON.parse(calls[1][1].body), { title: '<script> & things', description: 'A\nB' });
  assert.equal(calls[1][1].headers['Content-Type'], 'application/json');
});

test('network and malformed response errors remain readable', async () => {
  await assert.rejects(createRequester(async () => { throw new TypeError('offline'); })('/'), error => error instanceof ApiError && error.status === 0 && /connection/.test(error.message));
  await assert.rejects(createRequester(async () => new Response('<html>bad gateway</html>', { status: 502 }))('/'), /502/);
  await assert.rejects(createRequester(async () => new Response('bad json'))('/'), /unreadable/);
});

test('refresh queue coalesces events and reads again after an in-flight change', async () => {
  const resolvers = [];
  const received = [];
  const refresh = createRefreshQueue(() => new Promise(resolve => resolvers.push(resolve)), value => received.push(value), assert.fail);
  const first = refresh();
  assert.equal(refresh(), first);
  refresh();
  assert.equal(resolvers.length, 1);
  resolvers[0]('old');
  await Promise.resolve();
  assert.equal(resolvers.length, 2);
  resolvers[1]('new');
  await first;
  assert.deepEqual(received, ['old', 'new']);
});

test('a failed refresh does not prevent subsequent recovery', async () => {
  let fail = true;
  const errors = [];
  const received = [];
  const refresh = createRefreshQueue(async () => { if (fail) throw new Error('offline'); return 'recovered'; }, value => received.push(value), error => errors.push(error.message));
  await refresh();
  fail = false;
  await refresh();
  assert.deepEqual(errors, ['offline']);
  assert.deepEqual(received, ['recovered']);
});

test('a refresh requested as a snapshot completes is not lost', async () => {
  let count = 0;
  const received = [];
  let refresh;
  refresh = createRefreshQueue(async () => ++count, value => {
    received.push(value);
    if (value === 1) queueMicrotask(() => refresh());
  }, assert.fail);
  await refresh();
  assert.deepEqual(received, [1, 2]);
});
