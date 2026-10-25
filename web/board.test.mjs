import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedCards, dropIndex, renderBoard, matchesLabel, columnFull, destinationIndex } from './board-view.mjs';
import { installDom } from './test-dom.mjs';

test('column ordering uses positions without mutating the live snapshot', () => {
  const cards = [
    { id: 'b', column: 'todo', position: 1 },
    { id: 'c', column: 'done', position: 0 },
    { id: 'a', column: 'todo', position: 0 },
  ];
  assert.deepEqual(orderedCards(cards, 'todo').map(card => card.id), ['a', 'b']);
  assert.equal(cards[0].id, 'b');
});

test('drop positions exclude the source card for moves within a column', () => {
  const cards = ['a', 'b', 'c'].map((id, index) => ({ id, top: index * 100, height: 80 }));
  assert.equal(dropIndex(cards, 'a', 10), 0);
  assert.equal(dropIndex(cards, 'a', 160), 1);
  assert.equal(dropIndex(cards, 'a', 280), 2);
  assert.equal(dropIndex(cards, 'c', 10), 0);
});

test('cross-column drops handle middle, end and empty columns', () => {
  const cards = [{ id: 'a', top: 20, height: 80 }, { id: 'b', top: 120, height: 80 }];
  assert.equal(dropIndex(cards, 'elsewhere', 0), 0);
  assert.equal(dropIndex(cards, 'elsewhere', 100), 1);
  assert.equal(dropIndex(cards, 'elsewhere', 200), 2);
  assert.equal(dropIndex([], 'elsewhere', 100), 0);
});

test('board controls move cards and render user text literally', t => {
  const root = installDom(t);
  const moves = [];
  const removed = [];
  renderBoard(root, ['todo', 'doing', 'done'], [
    { id: 'a', title: '<script>task</script>', column: 'todo', position: 0 },
    { id: 'b', title: 'Second', column: 'todo', position: 1 },
  ], { move: (...args) => moves.push(args), remove: id => removed.push(id) });
  assert.equal(root.querySelectorAll('h4')[0].textContent, '<script>task</script>');
  assert.equal(root.querySelectorAll('script').length, 0);
  const select = root.querySelectorAll('select')[0];
  select.value = 'doing';
  select.fire('change');
  root.querySelectorAll('button').find(node => node.attributes['aria-label'] === 'Move <script>task</script> down').fire('click');
  root.querySelectorAll('button').find(node => node.attributes['aria-label'] === 'Delete Second').fire('click');
  assert.deepEqual(moves, [['a', 'doing', 0], ['a', 'todo', 1]]);
  assert.deepEqual(removed, ['b']);
});

test('labels filter by exact name, render as text, and retain full-board positions', t => {
  const root = installDom(t);
  const cards = [
    { id: 'hidden', title: 'Hidden', column: 'doing', position: 0, labels: [] },
    { id: 'visible', title: 'Visible', column: 'doing', position: 1, labels: [{ name: '<b>Bug</b>', color: 'red' }] },
    { id: 'old', title: 'Old task', column: 'done', position: 0 },
    ...[2, 3, 4].map(position => ({ id: `hidden-${position}`, title: 'Hidden', column: 'doing', position, labels: [] })),
  ];
  assert.equal(matchesLabel(cards[2], '<b>Bug</b>'), false);
  assert.equal(matchesLabel(cards[2], ''), true);
  renderBoard(root, ['todo', 'doing', 'done'], cards, {
    move: assert.fail, remove: assert.fail, labelFilter: '<b>Bug</b>', limits: { doing: 5 }, palette: ['red'],
  });
  assert.equal(root.querySelectorAll('.card').length, 1);
  assert.equal(root.querySelectorAll('.card-label')[0].textContent, '<b>Bug</b>');
  assert.equal(root.querySelectorAll('.card-label')[0].style['--label-color'], 'red');
  assert.equal(root.querySelectorAll('b').length, 0);
  assert.match(root.querySelectorAll('.count')[1].textContent, /5\/5.*Full/);
  assert.equal(destinationIndex(cards, 'elsewhere', 'doing', [cards[1]], 0), 1);
  assert.equal(destinationIndex(cards, 'elsewhere', 'doing', [cards[1]], 1), 5);
});

test('API-provided capacity blocks incoming drag/drop and menu moves but allows reordering and leaving', t => {
  const root = installDom(t);
  const cards = [
    { id: 'outside', title: 'Outside', column: 'todo', position: 0 },
    { id: 'a', title: 'First', column: 'doing', position: 0 },
    { id: 'b', title: 'Second', column: 'doing', position: 1 },
    ...[2, 3, 4].map(position => ({ id: `other-${position}`, title: 'Other', column: 'doing', position })),
  ];
  const moves = [];
  const draw = () => renderBoard(root, ['todo', 'doing', 'done'], cards, {
    move: (...args) => moves.push(args), remove: assert.fail, limits: { doing: 5 },
  });
  draw();
  assert.equal(root.querySelectorAll('select')[0].children[1].disabled, true);
  assert.equal(root.querySelectorAll('select')[1].children[1].disabled, false);
  const incoming = root.querySelectorAll('select')[0];
  incoming.value = 'doing';
  incoming.fire('change');
  assert.deepEqual(moves, []);
  const [todo, doing, done] = root.children;
  root.querySelectorAll('.card')[0].fire('dragstart');
  assert.equal(doing.fire('dragover').defaultPrevented, undefined);
  doing.fire('drop');
  assert.deepEqual(moves, []);
  root.querySelectorAll('.card')[1].fire('dragstart');
  assert.equal(doing.fire('dragover').defaultPrevented, true);
  doing.fire('drop');
  assert.deepEqual(moves, [['a', 'doing', 4]]);
  root.querySelectorAll('.card')[1].fire('dragstart');
  done.fire('drop');
  assert.deepEqual(moves.at(-1), ['a', 'done', 0]);
  cards.pop(); // A live snapshot can free capacity without changing the fixed limit.
  draw();
  assert.equal(root.children[1].classList.contains('full'), false);
  root.querySelectorAll('.card')[0].fire('dragstart');
  root.children[1].fire('drop');
  assert.deepEqual(moves.at(-1), ['outside', 'doing', 4]);
  // The browser uses API metadata rather than embedding the canonical store cap.
  assert.equal(columnFull(cards, 'doing', { doing: 4 }), true);
  assert.equal(columnFull(cards, 'doing', { doing: 6 }), false);
});
