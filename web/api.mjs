import { ApiError, createRequester } from './board.mjs';

// dibs: board.api proposal 2 revision 1; board.events proposal 3 revision 1.
export const COLUMN_DEFS = Object.freeze([
  Object.freeze({ id: 'todo', label: 'To do', color: '#989c8b' }),
  Object.freeze({ id: 'doing', label: 'In progress', color: '#c19a53' }),
  Object.freeze({ id: 'done', label: 'Done', color: '#6b9471' }),
]);
export const CHANGE_EVENTS = Object.freeze(['card.created', 'card.updated', 'card.moved', 'card.deleted']);

export function createApi(fetcher = globalThis.fetch) {
  const request = createRequester(fetcher);
  const path = id => `/api/cards/${encodeURIComponent(id)}`;
  return {
    async list() {
      const cards = await request('/api/cards');
      const ids = new Set();
      if (!Array.isArray(cards) || cards.some(card => {
        if (!card || typeof card.id !== 'string' || !card.id || ids.has(card.id)
          || !['title', 'description', 'assignee'].every(field => typeof card[field] === 'string')
          || !COLUMN_DEFS.some(column => column.id === card.column)
          || !Number.isInteger(card.position) || card.position < 0) return true;
        ids.add(card.id);
        return false;
      })) throw new ApiError('The server returned an invalid board. Please retry.', 200);
      return cards;
    },
    create: fields => request('/api/cards', 'POST', fields),
    update: (id, fields) => request(path(id), 'PATCH', fields),
    move: (id, column, position) => request(path(id), 'PATCH', { column, position }),
    remove: id => request(path(id), 'DELETE'),
  };
}

export const api = createApi();

export function subscribe({ change, connected, disconnected }, EventSourceClass = globalThis.EventSource) {
  let stream;
  try { stream = new EventSourceClass('/api/events'); }
  catch { disconnected(); return () => {}; }
  stream.addEventListener('open', connected);
  stream.addEventListener('error', disconnected);
  for (const name of CHANGE_EVENTS) stream.addEventListener(name, change);
  return () => stream.close();
}
