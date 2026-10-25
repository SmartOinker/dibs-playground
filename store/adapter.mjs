import { EventEmitter } from 'node:events';
import { openBoard } from './board-core.mjs';

// The validation dependency is owned by shared/cards.js, not by the store.
export function createStoreAdapter({ filePath }, validation, columnLimits) {
  const { COLUMNS, newId, validateCard, validateMove } = validation;
  const limits = Object.freeze({ ...columnLimits });
  const events = new EventEmitter();
  function unwrap(result) {
    if (!result.ok) {
      throw Object.assign(new Error(result.error), {
        code: 'VALIDATION_ERROR',
        ...(result.errors ? { errors: { ...result.errors } } : {}),
      });
    }
    return result.value;
  }
  const ready = openBoard({
    filePath,
    columns: COLUMNS,
    newId,
    normalize: (input, options) => unwrap(validateCard(input, options)),
    validateMove: (input) => unwrap(validateMove(input)),
    labelNames: (card) => (card.labels ?? []).map((label) => label.name),
    limits,
  }).then((board) => {
    board.on('change', (event) => events.emit('change', event));
    return board;
  });
  // Initialization failures are surfaced by every async method, not as unhandled rejections.
  ready.catch(() => {});
  const store = {
    get limits() {
      return limits;
    },
    on(event, listener) {
      events.on(event, listener);
      return store;
    },
    off(event, listener) {
      events.off(event, listener);
      return store;
    },
  };
  for (const method of ['list', 'get', 'create', 'update', 'move', 'remove', 'listLabels']) {
    store[method] = async (...args) => {
      const captured = structuredClone(args);
      return (await ready)[method](...captured);
    };
  }
  return store;
}
