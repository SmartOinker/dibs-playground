import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { writeJson } from './atomic-json.mjs';

function invalid(message) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });
}

// Private engine: validation, ids, and column vocabulary are supplied by an adapter.
export async function openBoard({
  filePath, columns, normalize, validateMove, newId, limits = {}, labelNames = () => [],
}) {
  const columnLimits = Object.freeze({ ...limits });
  function checkCapacity(column, count) {
    if (columnLimits[column] !== undefined && count >= columnLimits[column]) {
      throw Object.assign(invalid(`WIP limit reached for column '${column}'`), {
        errors: { column: `${column} column is full` },
      });
    }
  }
  let saved;
  try {
    saved = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    saved = [];
    await writeJson(filePath, saved);
  }
  if (!Array.isArray(saved)) throw invalid('Stored board must be an array');
  function collectLabels(next) {
    const names = next.flatMap(labelNames);
    if (names.some((name) => typeof name !== 'string' || !name.trim())) {
      throw invalid('Known labels must be non-empty strings');
    }
    return [...new Set(names)].sort();
  }
  const ids = new Set();
  let cards = saved.map((card) => {
    if (!card || typeof card.id !== 'string' || !card.id || ids.has(card.id)) {
      throw invalid('Stored card ids must be non-empty and unique');
    }
    ids.add(card.id);
    const value = normalize(card);
    if (!columns.includes(value.column) || !Number.isInteger(value.position) || value.position < 0) {
      throw invalid('Invalid stored card position or column');
    }
    return { ...value, id: card.id };
  });
  cards.sort((a, b) => columns.indexOf(a.column) - columns.indexOf(b.column) || a.position - b.position);
  for (const column of columns) {
    const group = cards.filter((card) => card.column === column);
    if (group.some((card, index) => card.position !== index)) {
      throw invalid('Stored positions must be contiguous within each column');
    }
    if (group.length) checkCapacity(column, group.length - 1);
  }
  collectLabels(cards);

  const events = new EventEmitter();
  let pending = Promise.resolve();
  function run(task) {
    const result = pending.then(task);
    pending = result.catch(() => {});
    return result;
  }
  async function commit(next, type, id, deleted) {
    next.sort((a, b) => columns.indexOf(a.column) - columns.indexOf(b.column));
    const positions = new Map();
    for (const card of next) {
      card.position = positions.get(card.column) ?? 0;
      positions.set(card.column, card.position + 1);
    }
    const result = deleted ?? next.find((card) => card.id === id);
    collectLabels(next);
    if (JSON.stringify(next) !== JSON.stringify(cards)) {
      await writeJson(filePath, next);
      cards = next;
      events.emit('change', { type, card: structuredClone(result) });
    }
    return structuredClone(result);
  }
  return {
    get limits() {
      return columnLimits;
    },
    async list() {
      return run(() => structuredClone(cards));
    },
    async listLabels() {
      return run(() => collectLabels(cards));
    },
    async get(id) {
      return run(() => structuredClone(cards.find((card) => card.id === id) ?? null));
    },
    async create(input) {
      const captured = structuredClone(input);
      return run(async () => {
        const value = normalize(captured);
        const id = captured.id ?? newId();
        if (typeof id !== 'string' || !id || cards.some((card) => card.id === id)) {
          throw invalid('Card id must be non-empty and unique');
        }
        const next = structuredClone(cards);
        const group = next.filter((card) => card.column === value.column);
        checkCapacity(value.column, group.length);
        const card = { ...value, id };
        group.splice(Math.min(value.position ?? group.length, group.length), 0, card);
        return commit(
          [...next.filter((item) => item.column !== value.column), ...group],
          'card.created', id,
        );
      });
    },
    async update(id, patch) {
      const captured = structuredClone(patch);
      return run(async () => {
        if (!cards.some((card) => card.id === id)) return null;
        const value = normalize(captured, { partial: true });
        if (value.column !== undefined || value.position !== undefined) {
          throw invalid('Use move() to change column or position');
        }
        const next = structuredClone(cards);
        const current = next.find((card) => card.id === id);
        Object.assign(current, value, { id: current.id, column: current.column, position: current.position });
        return commit(next, 'card.updated', id);
      });
    },
    async move(id, column, position) {
      return run(async () => {
        if (!cards.some((card) => card.id === id)) return null;
        const target = validateMove({ column, position });
        const current = cards.find((card) => card.id === id);
        if (target.column !== current.column) {
          checkCapacity(target.column, cards.filter((card) => card.column === target.column).length);
        }
        const next = structuredClone(cards);
        const index = next.findIndex((card) => card.id === id);
        const [card] = next.splice(index, 1);
        card.column = target.column;
        const group = next.filter((item) => item.column === target.column);
        group.splice(Math.min(target.position, group.length), 0, card);
        return commit(
          [...next.filter((item) => item.column !== target.column), ...group],
          'card.moved', id,
        );
      });
    },
    async remove(id) {
      return run(async () => {
        const card = cards.find((item) => item.id === id);
        if (!card) return false;
        await commit(structuredClone(cards.filter((item) => item.id !== id)), 'card.deleted', id, card);
        return true;
      });
    },
    on(event, listener) {
      events.on(event, listener);
    },
    off(event, listener) {
      events.off(event, listener);
    },
  };
}
