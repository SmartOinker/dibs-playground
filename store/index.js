import { EventEmitter } from 'node:events';
import path from 'node:path';
import { COLUMNS, validateCard } from '../shared/cards.js';
import { readJson, writeJsonAtomic } from './atomic-file.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE_FIELDS = new Set(['title', 'description', 'assignee']);

function invalid(message) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCard(input) {
  if (!isObject(input)) throw invalid('Card must be an object');
  if (typeof input.id !== 'string' || !UUID.test(input.id)) {
    throw invalid('id must be a UUID supplied by shared/cards.js newId()');
  }
  if (!COLUMNS.includes(input.column)) throw invalid('column must be a valid column');
  if (!Number.isSafeInteger(input.position) || input.position < 0) {
    throw invalid('position must be a non-negative safe integer');
  }
  const result = validateCard(input);
  if (!result.ok) {
    throw invalid(result.errors.map(({ field, message }) => `${field}: ${message}`).join('; '));
  }
  return {
    id: input.id,
    title: result.value.title,
    description: result.value.description,
    assignee: result.value.assignee,
    column: result.value.column,
    position: result.value.position,
  };
}

function ordered(cards) {
  return cards.sort((a, b) =>
    COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column) || a.position - b.position);
}

function renumber(cards) {
  const positions = new Map(COLUMNS.map((column) => [column, 0]));
  for (const card of cards) {
    card.position = positions.get(card.column);
    positions.set(card.column, card.position + 1);
  }
  return ordered(cards);
}

function loadCards(data) {
  if (data === undefined) return [];
  if (!isObject(data) || !Array.isArray(data.cards)) {
    throw invalid('Stored board must be an object containing a cards array');
  }
  const cards = ordered(data.cards.map(normalizeCard));
  const ids = new Set();
  const positions = new Map(COLUMNS.map((column) => [column, 0]));
  for (const card of cards) {
    if (ids.has(card.id)) throw invalid('Stored board contains duplicate card ids');
    ids.add(card.id);
    if (card.position !== positions.get(card.column)) {
      throw invalid('Stored card positions must be contiguous and zero-based');
    }
    positions.set(card.column, card.position + 1);
  }
  return cards;
}

class Store extends EventEmitter {
  #file;
  #cards;
  #pending = Promise.resolve();

  constructor(file, cards) {
    super();
    this.#file = file;
    this.#cards = cards;
  }

  #enqueue(operation) {
    const result = this.#pending.then(operation);
    this.#pending = result.catch(() => {});
    return result;
  }

  async #save(cards, type, card) {
    if (this.#file !== undefined) await writeJsonAtomic(this.#file, { cards });
    this.#cards = cards;
    const result = { ...card };
    this.emit('change', { type, card: { ...card } });
    return result;
  }

  async listCards() {
    await this.#pending;
    return this.#cards.map((card) => ({ ...card }));
  }

  async getCard(id) {
    await this.#pending;
    const card = this.#cards.find((candidate) => candidate.id === id);
    return card ? { ...card } : null;
  }

  async createCard(input) {
    const card = normalizeCard(input);
    return this.#enqueue(async () => {
      if (this.#cards.some((candidate) => candidate.id === card.id)) {
        throw invalid('A card with this id already exists');
      }
      card.position = this.#cards.filter((candidate) => candidate.column === card.column).length;
      return this.#save(ordered([...this.#cards, card]), 'card.created', card);
    });
  }

  async updateCard(id, fields) {
    if (!isObject(fields)) throw invalid('Fields must be an object');
    if (Object.keys(fields).some((field) => !EDITABLE_FIELDS.has(field))) {
      throw invalid('Only title, description and assignee can be updated; use moveCard to move');
    }
    const patch = { ...fields };
    return this.#enqueue(async () => {
      const current = this.#cards.find((card) => card.id === id);
      if (!current) return null;
      const card = normalizeCard({ ...current, ...patch });
      if (Object.keys(card).every((field) => card[field] === current[field])) return { ...current };
      const cards = this.#cards.map((candidate) => candidate.id === id ? card : candidate);
      return this.#save(cards, 'card.updated', card);
    });
  }

  async moveCard(id, column, position) {
    if (!COLUMNS.includes(column)) throw invalid('column must be a valid column');
    if (!Number.isSafeInteger(position)) throw invalid('position must be a safe integer');
    return this.#enqueue(async () => {
      const current = this.#cards.find((card) => card.id === id);
      if (!current) return null;
      const remaining = this.#cards.filter((card) => card.id !== id).map((card) => ({ ...card }));
      const destination = remaining.filter((card) => card.column === column);
      const index = Math.max(0, Math.min(position, destination.length));
      if (current.column === column && current.position === index) return { ...current };
      const card = { ...current, column, position: index };
      destination.splice(index, 0, card);
      const cards = renumber([
        ...remaining.filter((candidate) => candidate.column !== column),
        ...destination,
      ]);
      return this.#save(cards, 'card.moved', card);
    });
  }

  async deleteCard(id) {
    return this.#enqueue(async () => {
      const card = this.#cards.find((candidate) => candidate.id === id);
      if (!card) return null;
      const cards = renumber(this.#cards
        .filter((candidate) => candidate.id !== id)
        .map((candidate) => ({ ...candidate })));
      return this.#save(cards, 'card.deleted', card);
    });
  }

  async close() {
    await this.#pending;
  }
}

export async function createStore(options = {}) {
  if (!isObject(options)) throw invalid('Store options must be an object');
  const { file } = options;
  if (file !== undefined && (typeof file !== 'string' || file.trim() === '')) {
    throw invalid('file must be a non-empty path string');
  }
  const filePath = file === undefined ? undefined : path.resolve(file);
  const cards = filePath === undefined ? [] : loadCards(await readJson(filePath));
  return new Store(filePath, cards);
}
