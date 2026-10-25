import validation from '../shared/cards.js';
import { createStoreAdapter } from './adapter.mjs';

export function createStore(options) {
  return createStoreAdapter(options, validation, { doing: 5 });
}

export default createStore;
