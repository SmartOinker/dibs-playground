'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const { COLUMNS, validateCard } = require('../shared/cards');
const { readJson, writeJson } = require('./atomic-json');
const { renumber, insertAt } = require('./ordering');

function invalid(message, fields) {
  return Object.assign(new Error(message), { statusCode: 400, ...(fields && { fields }) });
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${name} must be an object`);
  }
}

function validateRecord(input) {
  assertObject(input, 'Card');
  const result = validateCard(input);
  if (!result.ok) throw invalid(result.errors.join('; '), result.fields);
  if (typeof input.id !== 'string' || !input.id.trim()) {
    throw invalid('Card id must be a non-empty string');
  }
  if (!Number.isSafeInteger(input.position) || input.position < 0) {
    throw invalid('Position must be a non-negative safe integer', { position: 'Invalid position' });
  }
  return {
    id: input.id,
    title: result.value.title,
    description: result.value.description,
    assignee: result.value.assignee,
    column: result.value.column,
    position: input.position,
  };
}

function validateBoard(input) {
  assertObject(input, 'Board');
  if (!Array.isArray(input.cards)) throw invalid('Board cards must be an array');
  const cards = input.cards.map(validateRecord);
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw invalid('Card ids must be unique');
  }
  for (const column of COLUMNS) {
    const positions = cards.filter((card) => card.column === column)
      .map((card) => card.position).sort((left, right) => left - right);
    if (positions.some((position, index) => position !== index)) {
      throw invalid('Card positions must be contiguous within each column');
    }
  }
  return { cards: renumber(cards, COLUMNS) };
}

async function createStore(options) {
  assertObject(options, 'Store options');
  if (typeof options.filePath !== 'string' || !options.filePath.trim()) {
    throw invalid('filePath must be a non-empty string');
  }
  const filePath = path.resolve(options.filePath);
  const saved = await readJson(filePath);
  let board = saved === undefined ? { cards: [] } : validateBoard(saved);
  if (saved === undefined) await writeJson(filePath, board);

  const store = new EventEmitter();
  let pending = Promise.resolve();
  function enqueue(operation) {
    const result = pending.then(operation);
    // A failed mutation must not poison later reads or mutations.
    pending = result.catch(() => {});
    return result;
  }

  function find(id) {
    const card = board.cards.find((entry) => entry.id === id);
    if (!card) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    return card;
  }

  async function commit(cards, type, changedCard) {
    const next = validateBoard({ cards });
    await writeJson(filePath, next);
    board = next;
    // Keep caller and event objects separate from committed in-memory state.
    const result = { ...changedCard };
    store.emit('change', { type, card: { ...changedCard } });
    return result;
  }

  store.getBoard = async function getBoard() {
    return enqueue(() => ({ cards: board.cards.map((card) => ({ ...card })) }));
  };

  store.createCard = async function createCard(input) {
    assertObject(input, 'Card');
    const copy = { ...input };
    return enqueue(async () => {
      const card = validateRecord(copy);
      if (board.cards.some((entry) => entry.id === card.id)) {
        throw invalid('Card id already exists');
      }
      const cards = insertAt(board.cards, card, card.column, card.position, COLUMNS);
      return commit(cards, 'card.created', cards.find((entry) => entry.id === card.id));
    });
  };

  store.updateCard = async function updateCard(id, patch) {
    assertObject(patch, 'Patch');
    const copy = { ...patch };
    return enqueue(async () => {
      const previous = find(id);
      const allowed = ['title', 'description', 'assignee'];
      if (Object.keys(copy).some((key) => !allowed.includes(key))) {
        throw invalid('Only title, description and assignee can be updated; use moveCard for placement');
      }
      const card = validateRecord({ ...previous, ...copy });
      return commit(
        board.cards.map((entry) => entry.id === id ? card : entry),
        'card.updated',
        card,
      );
    });
  };

  store.moveCard = async function moveCard(id, destination) {
    assertObject(destination, 'Destination');
    const { column, position } = destination;
    return enqueue(async () => {
      const previous = find(id);
      if (!COLUMNS.includes(column)) {
        throw invalid('Invalid column', { column: 'Invalid column' });
      }
      const card = validateRecord({ ...previous, column, position });
      const cards = insertAt(board.cards, card, column, position, COLUMNS);
      return commit(cards, 'card.moved', cards.find((entry) => entry.id === id));
    });
  };

  store.deleteCard = async function deleteCard(id) {
    return enqueue(async () => {
      const card = find(id);
      const cards = renumber(board.cards.filter((entry) => entry.id !== id), COLUMNS);
      return commit(cards, 'card.deleted', card);
    });
  };

  return store;
}

module.exports = createStore;
