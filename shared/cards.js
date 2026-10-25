// Card validation and ids, shared by the server, the store and the browser.
// Node: require('../shared/cards'). Browser: <script src="/shared/cards.js">
// exposes window.Cards. Keep this file free of Node-only built-ins.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Cards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLUMNS = Object.freeze(['todo', 'in-progress', 'done']);
  const TITLE_MAX = 80;

  function newId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    // randomUUID is missing on plain-http pages in some browsers.
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Returns { ok: true, value } or { ok: false, errors, fields }.
  // With { partial: true } (PATCH), absent fields are left out of value
  // instead of being required or defaulted.
  function validateCard(input, options) {
    const partial = Boolean(options && options.partial);
    const errors = [];
    const fields = {};
    const value = {};
    const fail = (field, message) => {
      errors.push(message);
      if (!(field in fields)) fields[field] = message;
    };

    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      fail('title', 'Card must be an object');
      return { ok: false, errors, fields };
    }
    const has = (key) => input[key] !== undefined;

    if (has('title') || !partial) {
      if (typeof input.title !== 'string') {
        fail('title', input.title == null ? 'Title is required' : 'Title must be a string');
      } else {
        const title = input.title.trim();
        if (!title) fail('title', 'Title is required');
        else if (title.length > TITLE_MAX) fail('title', `Title must be at most ${TITLE_MAX} characters`);
        else value.title = title;
      }
    }

    for (const key of ['description', 'assignee']) {
      const label = key[0].toUpperCase() + key.slice(1);
      if (input[key] === null || (!has(key) && !partial)) value[key] = '';
      else if (!has(key)) continue;
      else if (typeof input[key] !== 'string') fail(key, `${label} must be a string`);
      else value[key] = input[key].trim();
    }

    if (has('column')) {
      if (COLUMNS.includes(input.column)) value.column = input.column;
      else fail('column', `Column must be one of ${COLUMNS.join(', ')}`);
    } else if (!partial) {
      value.column = 'todo';
    }

    if (has('position')) {
      if (Number.isInteger(input.position) && input.position >= 0) value.position = input.position;
      else fail('position', 'Position must be an integer of 0 or more');
    }

    return errors.length ? { ok: false, errors, fields } : { ok: true, value };
  }

  return { COLUMNS, TITLE_MAX, newId, validateCard };
});
