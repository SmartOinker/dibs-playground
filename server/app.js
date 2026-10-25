// HTTP app: JSON card API, SSE live updates, and static files from web/.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS, validateCard, newId } from '../shared/cards.js';
import { createEventHub } from './events.js';
import { serveStatic } from './static.js';
import { HttpError, readJson, sendEmpty, sendJson } from './http.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_WEB_DIR = path.join(ROOT, 'web');
// shared/ is served at /shared/ so the browser can import /shared/cards.js.
const SHARED_DIR = path.join(ROOT, 'shared');

const CARD_ROUTE = /^\/api\/cards\/([^/]+)$/;
const EDIT_FIELDS = ['title', 'description', 'assignee'];
const MOVE_FIELDS = ['column', 'position'];

function sortCards(cards) {
  return [...cards].sort(
    (a, b) => COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column) || a.position - b.position,
  );
}

function validOrThrow(input, options) {
  const result = validateCard(input, options);
  if (!result.ok) throw new HttpError(400, result.errors.map((e) => e.message).join('; '));
  return result.value;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (Object.hasOwn(obj, k) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

const isEmpty = (obj) => Object.keys(obj).length === 0;

export function createApp({ store, webDir = DEFAULT_WEB_DIR, hub = createEventHub() } = {}) {
  if (!store) throw new Error('createApp requires a store');

  // The store emits one 'change' per durable save; relay each one as an SSE event.
  const onChange = ({ type, card }) => hub.publish(type, card);
  store.on('change', onChange);

  // Mutations are read-then-write (e.g. "append at column length"), so run them one at a time.
  let queue = Promise.resolve();
  function serialized(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  async function findCard(id) {
    const card = await store.getCard(id);
    if (!card) throw new HttpError(404, 'Card not found');
    return card;
  }

  async function columnLength(column, exceptId) {
    const cards = await store.listCards();
    return cards.filter((c) => c.column === column && c.id !== exceptId).length;
  }

  async function createCard(body) {
    const fields = validOrThrow(pick(body, ['title', 'description', 'assignee', 'column']));
    const position = await columnLength(fields.column);
    return store.createCard({ id: newId(), ...fields, position });
  }

  async function patchCard(id, body) {
    const edits = pick(body, EDIT_FIELDS);
    const move = pick(body, MOVE_FIELDS);
    if (isEmpty(edits) && isEmpty(move)) {
      throw new HttpError(400, `Request body must include at least one of ${[...EDIT_FIELDS, ...MOVE_FIELDS].join(', ')}`);
    }
    // Validate everything before writing anything, so a bad move doesn't leave a half-applied edit.
    const fields = isEmpty(edits) ? null : validOrThrow(edits, { partial: true });
    const target = isEmpty(move) ? null : validOrThrow(move, { partial: true });

    let card = await findCard(id);
    if (fields) {
      card = await store.updateCard(id, fields);
      if (!card) throw new HttpError(404, 'Card not found');
    }
    if (target) {
      const column = target.column ?? card.column;
      // Changing column without a position appends to the end of the new column.
      const position = target.position ?? (column === card.column ? card.position : await columnLength(column, id));
      card = await store.moveCard(id, column, position);
      if (!card) throw new HttpError(404, 'Card not found');
    }
    return card;
  }

  async function deleteCard(id) {
    const card = await store.deleteCard(id);
    if (!card) throw new HttpError(404, 'Card not found');
  }

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/events') {
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      hub.subscribe(req, res);
      return;
    }

    if (pathname === '/api/cards') {
      if (req.method === 'GET') {
        sendJson(res, 200, sortCards(await store.listCards()));
        return;
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        sendJson(res, 201, await serialized(() => createCard(body)));
        return;
      }
      throw new HttpError(405, 'Method not allowed');
    }

    const match = CARD_ROUTE.exec(pathname);
    if (match) {
      let id;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        throw new HttpError(404, 'Card not found');
      }
      if (req.method === 'GET') {
        sendJson(res, 200, await findCard(id));
        return;
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        sendJson(res, 200, await serialized(() => patchCard(id, body)));
        return;
      }
      if (req.method === 'DELETE') {
        await serialized(() => deleteCard(id));
        sendEmpty(res, 204);
        return;
      }
      throw new HttpError(405, 'Method not allowed');
    }

    throw new HttpError(404, 'Not found');
  }

  async function handle(req, res) {
    let pathname;
    try {
      ({ pathname } = new URL(req.url, 'http://localhost'));
    } catch {
      sendJson(res, 400, { error: 'Bad request URL' });
      return;
    }
    try {
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed');
      }
      const served = pathname.startsWith('/shared/') && pathname.endsWith('.js')
        ? await serveStatic(SHARED_DIR, pathname.slice('/shared'.length), req, res)
        : await serveStatic(webDir, pathname, req, res);
      if (!served) {
        throw new HttpError(404, 'Not found');
      }
    } catch (err) {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      if (err?.code === 'VALIDATION_ERROR') {
        sendJson(res, 400, { error: err.message });
        return;
      }
      if (err?.code === 'NOT_FOUND') {
        sendJson(res, 404, { error: 'Card not found' });
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  const server = http.createServer(handle);
  server.on('close', () => {
    store.off?.('change', onChange);
    hub.close();
  });
  return { server, hub, handle };
}
