import { createApi, subscribe } from './api.mjs';
import { createBoardState, cardFields } from './board-state.mjs';
import { columnLabel, renderBoard, columnFull, canEnter, matchesLabel } from './board-view.mjs';

const api = createApi();
const form = document.querySelector('#create-card');
const root = document.querySelector('#board');
const connection = document.querySelector('#connection');
const boardError = document.querySelector('#board-error');
const createError = document.querySelector('#create-error');
const labelFilter = document.querySelector('#label-filter');
const board = createBoardState();
const state = board.state;
let busy = false;
const errors = new Map();

function options(select, values) {
  const previous = select.value;
  select.replaceChildren(...values.map(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
  }));
  if (values.some(([value]) => value === previous)) select.value = previous;
}

function render() {
  const { columns, cards, limits, labelColors, loaded } = state;
  options(form.elements.column, columns.map(column => [column, columnLabel(column)]));
  for (const option of form.elements.column.options) {
    option.disabled = columnFull(cards, option.value, limits);
    if (option.disabled) option.textContent += ' · Full';
  }
  options(form.elements.labelColor, labelColors.map(color => [color, color]));
  const names = new Set(cards.flatMap(card => (card.labels || []).map(label => label.name)));
  if (labelFilter.value) names.add(labelFilter.value);
  options(labelFilter, [['', 'All labels'], ...[...names].sort().map(name => [name, name])]);
  const filter = labelFilter.value;
  renderBoard(root, columns, cards, { move, remove, busy: busy || !loaded, errors, limits, palette: labelColors, labelFilter: filter });
  document.querySelector('#total').textContent = filter ? `(${cards.filter(card => matchesLabel(card, filter)).length} of ${cards.length})` : `(${cards.length})`;
  root.setAttribute('aria-busy', String(!loaded));
  for (const control of form.elements) control.disabled = !loaded || busy;
  form.elements.labelColor.disabled ||= !labelColors.length;
  form.querySelector('button[type="submit"]').disabled ||= columnFull(cards, form.elements.column.value, limits);
}

async function refresh() {
  if (!await board.refresh(api.load)) return;
  boardError.textContent = '';
  render();
}

function clearValidation() {
  createError.textContent = '';
  for (const name of ['title', 'description', 'assignee', 'column', 'labels']) {
    document.querySelector(`#${name}-error`).textContent = '';
    form.elements[name === 'labels' ? 'labelNames' : name].removeAttribute('aria-invalid');
  }
}

function showValidation(error) {
  createError.textContent = error.message;
  for (const [field, message] of Object.entries(error.fields || {})) {
    const target = document.getElementById(`${field}-error`);
    const control = form.elements[field === 'labels' ? 'labelNames' : field];
    if (!target || !control) continue;
    target.textContent = String(message);
    control.setAttribute('aria-invalid', 'true');
  }
}

async function mutate(action, onError, onSuccess = () => {}) {
  if (busy) return;
  busy = true;
  let saved = false;
  render();
  try {
    await action();
    saved = true;
    try { await refresh(); }
    catch { boardError.textContent = 'Task saved. Waiting for the board to reconnect.'; }
  } catch (error) { onError(error); }
  finally { busy = false; render(); }
  if (saved) onSuccess();
}

function cardAction(id, action) {
  errors.delete(id);
  return mutate(action, error => {
    const details = Object.values(error.fields || {}).map(String);
    errors.set(id, [error.message, ...details].join('\n'));
  });
}
function move(id, column, position) {
  if (!canEnter(state.cards, id, column, state.limits)) {
    errors.set(id, `${columnLabel(column)} column is full.`);
    render();
    return;
  }
  return cardAction(id, () => api.move(id, column, position));
}
function remove(id) { return cardAction(id, () => api.remove(id)); }

form.addEventListener('submit', event => {
  event.preventDefault();
  clearValidation();
  if (!state.loaded || busy) return;
  let fields;
  try { fields = cardFields(new FormData(form), state.labelColors); }
  catch (error) { showValidation(error); return; }
  if (columnFull(state.cards, fields.column, state.limits)) {
    showValidation({ message: `${columnLabel(fields.column)} column is full.`, fields: { column: 'Choose another column.' } });
    return;
  }
  mutate(() => api.create(fields), showValidation, () => {
    const column = form.elements.column.value;
    form.reset();
    form.elements.column.value = column;
    render();
    form.elements.title.focus();
  });
});
form.addEventListener('input', clearValidation);
form.elements.column.addEventListener('change', render);
labelFilter.addEventListener('change', render);

render();
// Connect even if the initial read fails: a reconnect snapshot can recover the UI.
function connect() { return subscribe({
  cards(snapshot) {
    board.receive(snapshot);
    render();
    // Card-only SSE updates do not contain the palette or store-owned WIP limit.
    refresh().catch(error => { boardError.textContent = error.message; });
  },
  status(text) { connection.textContent = text; },
  error(text) { connection.textContent = text; },
}); }
let stop = connect();
refresh().catch(error => { if (!state.loaded) boardError.textContent = error.message; });
window.addEventListener('pagehide', () => stop());
window.addEventListener('pageshow', event => { if (event.persisted) stop = connect(); });
