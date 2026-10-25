export const COLUMN_LABELS = { todo: 'To do', 'in-progress': 'In progress', done: 'Done' };

export function cardsInColumn(cards, column, excludingId) {
  return cards.filter(card => card.column === column && card.id !== excludingId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

// The destination index is measured AFTER removing the dragged card.
export function dropPosition(cards, column, draggedId, beforeId = null) {
  const siblings = cardsInColumn(cards, column, draggedId);
  const index = siblings.findIndex(card => card.id === beforeId);
  return index < 0 ? siblings.length : index;
}

export function initials(name) {
  return name.trim().split(/\s+/u).slice(0, 2).map(part => Array.from(part)[0] || '').join('').toUpperCase();
}
