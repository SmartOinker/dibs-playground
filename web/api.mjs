export class ApiError extends Error {
  constructor(message, status = 0, fields = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields && typeof fields === 'object' ? fields : {};
  }
}

export function createApi(fetcher = globalThis.fetch.bind(globalThis)) {
  async function request(path, method = 'GET', body) {
    let response;
    try {
      response = await fetcher(path, {
        method, cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError('Cannot reach the server. Check your connection and try again.');
    }
    if (response.status === 204 && response.ok) return null;
    let data;
    try { data = await response.json(); } catch {
      throw new ApiError(response.ok ? 'The server returned an unreadable response.' : `Request failed (${response.status}).`, response.status);
    }
    if (!response.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : `Request failed (${response.status}).`, response.status, data?.fields);
    return data;
  }
  const path = id => `/api/cards/${encodeURIComponent(id)}`;
  return {
    async list() {
      const cards = await request('/api/cards');
      if (!Array.isArray(cards)) throw new ApiError('The server returned an invalid board.');
      return cards;
    },
    create: input => request('/api/cards', 'POST', input),
    update: (id, patch) => request(path(id), 'PATCH', patch),
    move: (id, column, position) => request(path(id), 'PATCH', { column, position }),
    remove: id => request(path(id), 'DELETE'),
  };
}

export const CHANGE_EVENTS = ['card.created', 'card.updated', 'card.moved', 'card.deleted'];

export function subscribe(onChange, onState, Source = globalThis.EventSource) {
  const stream = new Source('/api/events');
  stream.addEventListener('open', () => { onState('live'); onChange(); });
  stream.addEventListener('error', () => onState('offline'));
  for (const name of CHANGE_EVENTS) stream.addEventListener(name, onChange);
  return () => stream.close();
}

// Coalesce bursts without losing changes received while a GET is in flight.
export function createRefreshQueue(refresh) {
  let pending = false;
  let running = null;
  return function requestRefresh() {
    pending = true;
    if (!running) {
      running = (async () => {
        try {
          while (pending) { pending = false; await refresh(); }
        } finally { running = null; }
      })();
    }
    return running;
  };
}
