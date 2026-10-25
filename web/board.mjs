// Pure board helpers shared by the browser and the dependency-free tests.
export function orderedCards(cards, column) {
  return cards.filter(card => card.column === column)
    .sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)));
}

// The destination index is measured after removing the dragged card.
export function dropIndex(cards, column, draggedId, beforeId = null) {
  const destination = orderedCards(cards, column).filter(card => card.id !== draggedId);
  const before = destination.findIndex(card => card.id === beforeId);
  return before < 0 ? destination.length : before;
}

export function initials(name) {
  return String(name).trim().split(/\s+/u).filter(Boolean).slice(0, 2)
    .map(word => [...word][0]).join('').toLocaleUpperCase();
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function createRequester(fetcher = globalThis.fetch) {
  return async function request(path, method = 'GET', body) {
    let response;
    try {
      response = await fetcher(path, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
    }
    let data;
    if (response.status !== 204) {
      try { data = await response.json(); }
      catch {
        throw new ApiError(response.ok ? 'The server returned an unreadable response.' : `Request failed (${response.status}). Please try again.`, response.status);
      }
    }
    if (!response.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : `Request failed (${response.status}).`, response.status);
    return data;
  };
}

// Coalesce bursts of change events. A change received during an in-flight read
// schedules another read, so an older snapshot can never be the last one shown.
export function createRefreshQueue(read, receive, failed) {
  let pending = false;
  let current = null;
  return function refresh() {
    pending = true;
    if (current) return current;
    current = (async () => {
      while (pending) {
        pending = false;
        try { receive(await read()); }
        catch (error) { failed(error); }
      }
    })().finally(() => {
      current = null;
      if (pending) return refresh();
    });
    return current;
  };
}
