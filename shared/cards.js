// Card validation and ids, shared by the server and the browser board.
// ESM, no Node-only imports: works in Node and in the browser as-is.

export const COLUMNS = ['todo', 'doing', 'done'];

export const TITLE_MAX = 80;

export function newId() {
  return globalThis.crypto.randomUUID();
}

// Validates and normalizes card input.
// partial=false (create): title required; description/assignee default to ''; column defaults to 'todo'.
// partial=true (update): only the fields present in input are checked and returned, so an
// update never blanks fields it didn't mention.
// Returns { ok: true, value } or { ok: false, errors: [{ field, message }] }.
export function validateCard(input, { partial = false } = {}) {
  const errors = [];
  const value = {};

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ field: 'card', message: 'card must be an object' }] };
  }
  const has = (key) => Object.hasOwn(input, key) && input[key] !== undefined;

  if (has('id')) {
    if (typeof input.id === 'string' && input.id.trim()) value.id = input.id;
    else errors.push({ field: 'id', message: 'id must be a non-empty string' });
  }

  if (has('title')) {
    if (typeof input.title !== 'string') {
      errors.push({ field: 'title', message: 'title must be a string' });
    } else {
      const title = input.title.trim();
      if (!title) errors.push({ field: 'title', message: 'title is required' });
      else if (title.length > TITLE_MAX) {
        errors.push({ field: 'title', message: `title must be at most ${TITLE_MAX} characters` });
      } else value.title = title;
    }
  } else if (!partial) {
    errors.push({ field: 'title', message: 'title is required' });
  }

  for (const field of ['description', 'assignee']) {
    if (has(field)) {
      if (typeof input[field] === 'string') value[field] = input[field].trim();
      else errors.push({ field, message: `${field} must be a string` });
    } else if (!partial) {
      value[field] = '';
    }
  }

  if (has('column')) {
    if (COLUMNS.includes(input.column)) value.column = input.column;
    else errors.push({ field: 'column', message: `column must be one of ${COLUMNS.join(', ')}` });
  } else if (!partial) {
    value.column = COLUMNS[0];
  }

  if (has('position')) {
    if (Number.isInteger(input.position) && input.position >= 0) value.position = input.position;
    else errors.push({ field: 'position', message: 'position must be a non-negative integer' });
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}
