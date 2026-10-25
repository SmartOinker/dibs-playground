'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { renumber, insertAt } = require('./ordering');

const columns = ['first', 'second', 'third'];
const card = (id, column, position) => ({ id, column, position, title: id });
const ids = (cards, column) => cards.filter((entry) => entry.column === column)
  .map((entry) => entry.id);

test('renumbers each column in configured order without mutating input', () => {
  const input = [
    card('c', 'second', 5),
    card('b', 'first', 8),
    card('a', 'first', 2),
  ];
  const original = structuredClone(input);
  assert.deepEqual(renumber(input, columns), [
    card('a', 'first', 0), card('b', 'first', 1), card('c', 'second', 0),
  ]);
  assert.deepEqual(input, original);
});

test('inserts a new card at the beginning, middle or end', () => {
  const input = [card('a', 'first', 0), card('b', 'first', 1)];
  assert.deepEqual(ids(insertAt(input, card('new', 'first', 0), 'first', 0, columns), 'first'),
    ['new', 'a', 'b']);
  assert.deepEqual(ids(insertAt(input, card('new', 'first', 0), 'first', 1, columns), 'first'),
    ['a', 'new', 'b']);
  assert.deepEqual(ids(insertAt(input, card('new', 'first', 0), 'first', 2, columns), 'first'),
    ['a', 'b', 'new']);
});

test('moving forward and backward uses the final destination index', () => {
  const input = ['a', 'b', 'c', 'd'].map((id, index) => card(id, 'first', index));
  assert.deepEqual(ids(insertAt(input, input[0], 'first', 2, columns), 'first'),
    ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids(insertAt(input, input[3], 'first', 1, columns), 'first'),
    ['a', 'd', 'b', 'c']);
  assert.deepEqual(ids(input, 'first'), ['a', 'b', 'c', 'd']);
});

test('moving between columns compacts the source and destination', () => {
  const input = [
    card('a', 'first', 0), card('b', 'first', 1),
    card('c', 'second', 0), card('d', 'second', 1),
  ];
  assert.deepEqual(insertAt(input, input[0], 'second', 1, columns), [
    card('b', 'first', 0), card('c', 'second', 0),
    card('a', 'second', 1), card('d', 'second', 2),
  ]);
});
