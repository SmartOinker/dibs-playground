const crypto = require('node:crypto');

const COLUMNS = ['todo', 'doing', 'done'];
const LABEL_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];
const MAX_TITLE = 80;
const MAX_LABELS = 10;
const MAX_LABEL = 30;

function newId() {
  return crypto.randomUUID();
}

function validateCard(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'body must be an object' };
  }
  const errors = {};
  const value = {};
  const has = (k) => input[k] !== undefined;

  if (has('title')) {
    const t = typeof input.title === 'string' ? input.title.trim() : null;
    if (t === null) errors.title = 'title must be a string';
    else if (!t) errors.title = 'title must not be empty';
    else if (t.length > MAX_TITLE) errors.title = `title must be at most ${MAX_TITLE} characters`;
    else value.title = t;
  } else if (!partial) {
    errors.title = 'title is required';
  }

  for (const k of ['description', 'assignee']) {
    if (has(k)) {
      if (typeof input[k] !== 'string') errors[k] = `${k} must be a string`;
      else value[k] = input[k];
    } else if (!partial) {
      value[k] = '';
    }
  }

  if (has('labels')) {
    const l = input.labels;
    const name = (x) => (x && typeof x.name === 'string' ? x.name.trim() : '');
    if (!Array.isArray(l) || l.some((x) => !name(x) || !LABEL_COLORS.includes(x.color))) {
      errors.labels = `labels must be { name, color } with color one of ${LABEL_COLORS.join(', ')}`;
    } else if (l.some((x) => name(x).length > MAX_LABEL)) {
      errors.labels = `label names must be at most ${MAX_LABEL} characters`;
    } else {
      const byName = new Map();
      for (const x of l) if (!byName.has(name(x))) byName.set(name(x), { name: name(x), color: x.color });
      if (byName.size > MAX_LABELS) errors.labels = `at most ${MAX_LABELS} labels`;
      else value.labels = [...byName.values()];
    }
  } else if (!partial) {
    value.labels = [];
  }

  if (has('column')) {
    if (!COLUMNS.includes(input.column)) errors.column = `column must be one of ${COLUMNS.join(', ')}`;
    else value.column = input.column;
  } else if (!partial) {
    value.column = 'todo';
  }

  if (has('position')) {
    if (!Number.isInteger(input.position) || input.position < 0) {
      errors.position = 'position must be a non-negative integer';
    } else value.position = input.position;
  }

  const fields = Object.keys(errors);
  if (fields.length) return { ok: false, error: errors[fields[0]], errors };
  return { ok: true, value };
}

function validateMove(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'body must be an object' };
  if (!COLUMNS.includes(input.column)) return { ok: false, error: 'invalid column' };
  if (!Number.isInteger(input.position) || input.position < 0) {
    return { ok: false, error: 'position must be a non-negative integer' };
  }
  return { ok: true, value: { column: input.column, position: input.position } };
}

module.exports = { COLUMNS, LABEL_COLORS, newId, validateCard, validateMove };
