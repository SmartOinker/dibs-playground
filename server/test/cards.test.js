import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, TITLE_MAX, newId, validateCard } from '../../shared/cards.js';

test('exports the agreed columns and title limit', () => {
  assert.deepEqual(COLUMNS, ['todo', 'doing', 'done']);
  assert.equal(TITLE_MAX, 80);
});

test('newId returns unique UUIDs', () => {
  const a = newId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(a, newId());
});

test('full validation normalizes and fills defaults', () => {
  const result = validateCard({ title: '  Write docs  ', extra: 1 });
  assert.deepEqual(result, {
    ok: true,
    value: { title: 'Write docs', description: '', assignee: '', column: 'todo' },
  });
});

test('title is required, trimmed and at most 80 characters', () => {
  for (const input of [{}, { title: '' }, { title: '   ' }]) {
    const result = validateCard(input);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [{ field: 'title', message: 'title is required' }]);
  }
  assert.equal(validateCard({ title: 'x'.repeat(80) }).ok, true);
  assert.equal(validateCard({ title: ` ${'x'.repeat(80)} ` }).ok, true);
  const long = validateCard({ title: 'x'.repeat(81) });
  assert.equal(long.ok, false);
  assert.equal(long.errors[0].field, 'title');
  assert.equal(validateCard({ title: 42 }).ok, false);
});

test('rejects bad column, position and field types with field-prefixed messages', () => {
  const result = validateCard({ title: 'ok', column: 'backlog', position: -1, assignee: 7 });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map((e) => e.field).sort(),
    ['assignee', 'column', 'position'],
  );
  for (const e of result.errors) assert.ok(e.message.startsWith(e.field), e.message);
  assert.equal(validateCard({ title: 'ok', position: 1.5 }).ok, false);
  assert.equal(validateCard(null).ok, false);
  assert.equal(validateCard([]).ok, false);
});

test('partial validation only returns the fields given', () => {
  assert.deepEqual(validateCard({}, { partial: true }), { ok: true, value: {} });
  assert.deepEqual(validateCard({ assignee: ' sam ' }, { partial: true }), {
    ok: true,
    value: { assignee: 'sam' },
  });
  assert.deepEqual(validateCard({ column: 'done', position: 0 }, { partial: true }), {
    ok: true,
    value: { column: 'done', position: 0 },
  });
  assert.equal(validateCard({ title: '' }, { partial: true }).ok, false);
});
