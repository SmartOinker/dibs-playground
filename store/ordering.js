'use strict';

function renumber(cards, columns) {
  return columns.flatMap((column) => cards
    .filter((card) => card.column === column)
    .sort((left, right) => left.position - right.position)
    .map((card, position) => ({ ...card, position })));
}

function insertAt(cards, card, column, position, columns) {
  const remaining = cards.filter((entry) => entry.id !== card.id);
  const destination = remaining
    .filter((entry) => entry.column === column)
    .sort((left, right) => left.position - right.position);
  destination.splice(position, 0, { ...card, column });
  const ordered = destination.map((entry, index) => ({ ...entry, position: index }));
  return renumber([
    ...remaining.filter((entry) => entry.column !== column),
    ...ordered,
  ], columns);
}

module.exports = { renumber, insertAt };
