'use strict';

const { COLUMNS, newId, validateCard } = require('../shared/cards');
const { HttpError } = require('./http');

const EDITABLE = ['title', 'description', 'assignee'];

function invalid(result) {
  return new HttpError(400, result.errors.join('; '), { fields: result.fields });
}

function sortCards(cards) {
  return cards.slice().sort((a, b) =>
    COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column) || a.position - b.position);
}

// Maps the REST API onto the store (store/index.js, contract board.store).
// Mutations run one at a time so "end of column" positions don't race.
function createBoard(store) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function list() {
    const { cards } = await store.getBoard();
    return sortCards(cards);
  }

  async function get(id) {
    const { cards } = await store.getBoard();
    const card = cards.find((c) => c.id === id);
    if (!card) throw new HttpError(404, 'Card not found');
    return card;
  }

  function create(body) {
    const result = validateCard(body);
    if (!result.ok) throw invalid(result);
    const { title, description, assignee, column } = result.value;
    return serial(async () => {
      const { cards } = await store.getBoard();
      const position = cards.filter((c) => c.column === column).length;
      return store.createCard({ id: newId(), title, description, assignee, column, position });
    });
  }

  // Field edits and a move ({ column, position }) may come in one request.
  function patch(id, body) {
    const result = validateCard(body, { partial: true });
    if (!result.ok) throw invalid(result);
    const v = result.value;
    const edits = {};
    for (const key of EDITABLE) if (key in v) edits[key] = v[key];
    const moving = 'column' in v || 'position' in v;
    return serial(async () => {
      let card = await get(id);
      if (Object.keys(edits).length) card = await store.updateCard(id, edits);
      if (moving) {
        const column = v.column ?? card.column;
        let position = v.position;
        if (position === undefined) {
          const { cards } = await store.getBoard();
          position = cards.filter((c) => c.column === column && c.id !== id).length;
        }
        card = await store.moveCard(id, { column, position });
      }
      return card;
    });
  }

  function remove(id) {
    return serial(() => store.deleteCard(id));
  }

  return { list, get, create, patch, remove };
}

module.exports = { createBoard, sortCards };
