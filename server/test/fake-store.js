// In-memory stand-in for store/ that follows the agreed board.store contract.
// Tests use the real store/index.js when it is present and fall back to this otherwise.

import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COLUMNS = ['todo', 'doing', 'done'];
const REAL_STORE = new URL('../../store/index.js', import.meta.url);

export async function createTestStore() {
  if (existsSync(fileURLToPath(REAL_STORE))) {
    const { createStore } = await import(REAL_STORE);
    return createStore();
  }
  return createFakeStore();
}

export function createFakeStore() {
  const cards = new Map();
  const store = new EventEmitter();
  const copy = (c) => (c ? { ...c } : null);
  const inColumn = (column) =>
    [...cards.values()].filter((c) => c.column === column).sort((a, b) => a.position - b.position);
  const renumber = (column) => inColumn(column).forEach((c, i) => (c.position = i));
  const emit = (type, card) => store.emit('change', { type, card: copy(card) });

  store.listCards = async () => COLUMNS.flatMap(inColumn).map(copy);
  store.getCard = async (id) => copy(cards.get(id));
  store.createCard = async (card) => {
    const saved = { ...card, position: inColumn(card.column).length };
    cards.set(saved.id, saved);
    emit('card.created', saved);
    return copy(saved);
  };
  store.updateCard = async (id, fields) => {
    const card = cards.get(id);
    if (!card) return null;
    Object.assign(card, fields);
    emit('card.updated', card);
    return copy(card);
  };
  store.moveCard = async (id, column, position) => {
    const card = cards.get(id);
    if (!card) return null;
    const from = card.column;
    const dest = inColumn(column).filter((c) => c !== card);
    dest.splice(Math.max(0, Math.min(position, dest.length)), 0, card);
    card.column = column;
    dest.forEach((c, i) => (c.position = i));
    if (from !== column) renumber(from);
    emit('card.moved', card);
    return copy(card);
  };
  store.deleteCard = async (id) => {
    const card = cards.get(id);
    if (!card) return null;
    cards.delete(id);
    renumber(card.column);
    emit('card.deleted', card);
    return copy(card);
  };
  store.close = async () => {};
  return store;
}
