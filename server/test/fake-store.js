'use strict';

// In-memory test double that follows the board.store contract, so the
// server can be tested before (and independently of) store/index.js.
const { EventEmitter } = require('node:events');

function storeError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function createFakeStore(columns = ['todo', 'in-progress', 'done']) {
  const store = new EventEmitter();
  let cards = [];
  const copy = (c) => ({ ...c });
  const inColumn = (column, except) =>
    cards.filter((c) => c.column === column && c.id !== except).sort((a, b) => a.position - b.position);
  const reindex = (list) => list.forEach((c, i) => { c.position = i; });
  const find = (id) => {
    const card = cards.find((c) => c.id === id);
    if (!card) throw storeError(404, 'Not found');
    return card;
  };
  const place = (card, column, position) => {
    if (!columns.includes(column)) throw storeError(400, 'Invalid column');
    const target = inColumn(column, card.id);
    target.splice(Math.min(position, target.length), 0, card);
    card.column = column;
    reindex(target);
  };
  const emit = (type, card) => {
    const out = copy(card);
    store.emit('change', { type, card: out });
    return copy(card);
  };

  store.getBoard = async () => ({ cards: cards.map(copy) });
  store.createCard = async (input) => {
    const card = { ...input };
    cards.push(card);
    place(card, card.column, card.position);
    return emit('card.created', card);
  };
  store.updateCard = async (id, patch) => {
    const card = find(id);
    Object.assign(card, patch);
    return emit('card.updated', card);
  };
  store.moveCard = async (id, { column, position }) => {
    const card = find(id);
    const from = card.column;
    place(card, column, position);
    if (from !== column) reindex(inColumn(from));
    return emit('card.moved', card);
  };
  store.deleteCard = async (id) => {
    const card = find(id);
    cards = cards.filter((c) => c !== card);
    reindex(inColumn(card.column));
    return emit('card.deleted', card);
  };
  return store;
}

module.exports = { createFakeStore };
