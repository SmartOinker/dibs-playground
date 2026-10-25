export class ApiError extends Error {
  constructor(message, fields = {}, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.fields = fields && typeof fields === 'object' ? fields : {};
    this.status = status;
  }
}

export function createApi(fetcher = globalThis.fetch.bind(globalThis)) {
  async function request(path, method = 'GET', body) {
    let response;
    try {
      response = await fetcher(path, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection and try again.');
    }
    if (response.status === 204) return null;
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError('The server returned an unreadable response.', {}, response.status); }
    if (!response.ok) throw new ApiError(data.error || 'The request failed.', data.errors, response.status);
    return data;
  }
  return {
    load: () => request('/api/board'),
    create: fields => request('/api/cards', 'POST', fields),
    move: (id, column, position) => request(`/api/cards/${encodeURIComponent(id)}`, 'PATCH', { column, position }),
    remove: id => request(`/api/cards/${encodeURIComponent(id)}`, 'DELETE'),
  };
}

export function subscribe({ cards, status, error }, EventSourceClass = globalThis.EventSource) {
  const source = new EventSourceClass('/api/events');
  const receive = event => {
    try {
      const snapshot = JSON.parse(event.data);
      if (!Array.isArray(snapshot)) throw new Error('Expected a card array');
      cards(snapshot);
      status('Live');
    } catch { error('Could not read a live update. Reconnecting…'); source.close(); reconnect(); }
  };
  // Native EventSource retries network failures and receives a fresh snapshot.
  source.addEventListener('open', () => status('Live'));
  source.addEventListener('error', () => status('Connection lost · reconnecting…'));
  source.addEventListener('snapshot', receive);
  source.addEventListener('cards', receive);
  let retry;
  let next;
  let closed = false;
  function reconnect() {
    if (!closed && !retry) retry = setTimeout(() => {
      retry = null;
      if (!closed) next = subscribe({ cards, status, error }, EventSourceClass);
    }, 2000);
  }
  return () => { closed = true; clearTimeout(retry); source.close(); next?.(); };
}
