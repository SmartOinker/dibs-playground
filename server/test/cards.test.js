'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { COLUMNS, TITLE_MAX, newId, validateCard } = require('../../shared/cards');

test('exports the agreed columns and title limit', () => {
  assert.deepEqual([...COLUMNS], ['todo', 'in-progress', 'done']);
  assert.equal(TITLE_MAX, 80);
});

test('newId returns distinct UUID v4 strings', () => {
  const a = newId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, newId());
});

test('a full card gets trimmed and defaulted', () => {
  assert.deepEqual(validateCard({ title: '  Ship it ', id: 'ignored' }), {
    ok: true,
    value: { title: 'Ship it', description: '', assignee: '', column: 'todo' },
  });
  assert.deepEqual(validateCard({ title: 'x', description: null, assignee: ' ana ', column: 'done', position: 2 }).value, {
    title: 'x', description: '', assignee: 'ana', column: 'done', position: 2,
  });
});

test('title is required and at most 80 characters', () => {
  for (const title of [undefined, null, '', '   ']) {
    const r = validateCard({ title });
    assert.equal(r.ok, false);
    assert.equal(r.fields.title, 'Title is required');
  }
  assert.equal(validateCard({ title: 'a'.repeat(80) }).ok, true);
  const long = validateCard({ title: 'a'.repeat(81) });
  assert.equal(long.ok, false);
  assert.match(long.fields.title, /80/);
  assert.equal(validateCard({ title: 5 }).fields.title, 'Title must be a string');
});

test('rejects bad column, position and field types, reporting every field', () => {
  const r = validateCard({ title: '', column: 'doing', position: -1, description: 3, assignee: {} });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.fields).sort(), ['assignee', 'column', 'description', 'position', 'title']);
  assert.equal(r.errors.length, 5);
  assert.equal(validateCard({ title: 'x', position: 1.5 }).ok, false);
  assert.equal(validateCard(null).ok, false);
  assert.equal(validateCard([]).ok, false);
});

test('partial validation only returns the fields given', () => {
  assert.deepEqual(validateCard({}, { partial: true }), { ok: true, value: {} });
  assert.deepEqual(validateCard({ assignee: 'bo', position: 0 }, { partial: true }).value, { assignee: 'bo', position: 0 });
  assert.equal(validateCard({ title: ' ' }, { partial: true }).ok, false);
});
