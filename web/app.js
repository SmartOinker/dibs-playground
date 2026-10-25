import { COLUMN_DEFS, api, subscribe } from './api.mjs';
import { orderedCards, dropIndex, initials, createRefreshQueue } from './board.mjs';

const $ = id => document.getElementById(id);
const board = $('board');
const dialog = $('card-dialog');
const form = $('card-form');
let cards = [];
let loaded = false;
let busy = false;
let editing = null;
let draggingId = null;
let streamConnected = false;
let readFailed = false;
let beforeId = null;
let returnFocus = null;
let restoreFocusPending = false;
const marker = document.createElement('div');
marker.className = 'drop-marker';
marker.setAttribute('aria-hidden', 'true');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function announce(message) { $('announcement').textContent = message; }
function showBoardError(message) {
  $('board-error').textContent = message;
  $('board-error').hidden = !message;
}
function connectionStatus() {
  const online = streamConnected && !readFailed;
  $('connection-text').textContent = readFailed ? 'Could not refresh board' : online ? 'Live · all changes synced' : 'Reconnecting…';
  $('status-dot').className = `status-dot ${online ? 'connected' : 'offline'}`;
  $('retry').hidden = online;
}

const refresh = createRefreshQueue(api.list, next => {
  cards = next;
  loaded = true;
  readFailed = false;
  showBoardError('');
  board.setAttribute('aria-busy', 'false');
  if (!draggingId) render();
  connectionStatus();
}, error => {
  readFailed = true;
  board.setAttribute('aria-busy', 'false');
  if (!loaded) board.replaceChildren(element('p', 'loading', 'Your board could not be loaded. Use Retry to reconnect.'));
  showBoardError(error.message);
  connectionStatus();
});

function render() {
  const focusedId = document.activeElement?.dataset.cardId;
  const fragment = document.createDocumentFragment();
  board.style.setProperty('--column-count', COLUMN_DEFS.length);
  for (const [columnIndex, definition] of COLUMN_DEFS.entries()) {
    const columnCards = orderedCards(cards, definition.id);
    const section = element('section', 'column');
    section.dataset.column = definition.id;
    section.style.setProperty('--column-color', definition.color);
    section.setAttribute('aria-labelledby', `heading-${definition.id}`);
    const heading = element('h2', 'column-heading');
    heading.id = `heading-${definition.id}`;
    const dot = element('span', 'column-dot');
    dot.setAttribute('aria-hidden', 'true');
    heading.append(dot, document.createTextNode(definition.label));
    const count = element('span', 'column-count', columnCards.length);
    count.setAttribute('aria-label', `${columnCards.length} cards`);
    const add = element('button', 'column-add', '+');
    add.type = 'button';
    add.setAttribute('aria-label', `Add card to ${definition.label}`);
    add.addEventListener('click', () => openEditor(null, definition.id));
    heading.append(count, add);
    const list = element('div', 'card-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', `${definition.label} cards`);
    if (!columnCards.length) {
      const empty = element('div', 'empty-column');
      empty.append(element('span', 'empty-symbol', ['◇', '↗', '✓'][columnIndex] || '◇'), element('p', '', 'Room for the next step.\nAdd a card or drop one here.'));
      list.append(empty);
    }
    for (const card of columnCards) {
      const article = element('article', 'card');
      article.dataset.id = card.id;
      article.draggable = !busy;
      article.setAttribute('role', 'listitem');
      const title = element('h3', 'card-title', card.title);
      const edit = element('button', 'card-edit', '↗');
      edit.type = 'button';
      edit.dataset.cardId = card.id;
      edit.setAttribute('aria-label', `Edit ${card.title}`);
      edit.addEventListener('click', () => openEditor(card.id));
      // Do not initiate a drag when a user operates the edit control.
      edit.addEventListener('pointerdown', event => event.stopPropagation());
      article.append(title, edit);
      if (card.description) article.append(element('p', 'card-description', card.description));
      if (card.assignee) {
        const footer = element('div', 'card-footer');
        const avatar = element('span', 'avatar', initials(card.assignee));
        avatar.setAttribute('aria-hidden', 'true');
        footer.append(avatar, element('span', 'assignee-name', card.assignee));
        article.append(footer);
      }
      article.addEventListener('dragstart', event => {
        if (busy || event.target.closest('button')) { event.preventDefault(); return; }
        draggingId = card.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.id);
        article.classList.add('dragging');
      });
      article.addEventListener('dragend', finishDrag);
      list.append(article);
    }
    const footerAdd = element('button', 'column-new', '+  Add a card');
    footerAdd.type = 'button';
    footerAdd.setAttribute('aria-label', `Create card in ${definition.label}`);
    footerAdd.addEventListener('click', () => openEditor(null, definition.id));
    section.append(heading, list, footerAdd);
    section.addEventListener('dragover', event => dragOver(event, section, list));
    section.addEventListener('dragleave', event => {
      if (!section.contains(event.relatedTarget)) section.classList.remove('drop-active');
    });
    section.addEventListener('drop', event => drop(event, definition.id));
    fragment.append(section);
  }
  board.replaceChildren(fragment);
  $('total-count').textContent = cards.length;
  $('new-card').disabled = busy || !loaded;
  if (focusedId && !dialog.open) {
    const edit = [...board.querySelectorAll('.card-edit')].find(node => node.dataset.cardId === focusedId);
    (edit || $('new-card')).focus({ preventScroll: true });
  }
}

function dragOver(event, section, list) {
  if (!draggingId || busy) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  for (const active of board.querySelectorAll('.drop-active')) if (active !== section) active.classList.remove('drop-active');
  section.classList.add('drop-active');
  const target = [...list.querySelectorAll('.card')].find(node => node.dataset.id !== draggingId && event.clientY < node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2);
  beforeId = target?.dataset.id ?? null;
  list.insertBefore(marker, target || null);
}

function finishDrag() {
  draggingId = null;
  beforeId = null;
  marker.remove();
  for (const active of board.querySelectorAll('.drop-active, .dragging')) active.classList.remove('drop-active', 'dragging');
  if (loaded) render();
}

async function drop(event, column) {
  if (!draggingId || busy) return;
  event.preventDefault();
  const id = draggingId;
  const card = cards.find(item => item.id === id);
  const position = dropIndex(cards, column, id, beforeId);
  finishDrag();
  if (!card || (card.column === column && card.position === position)) return;
  setBusy(true);
  showBoardError('');
  try {
    await api.move(id, column, position);
    await refresh();
    announce(`Moved ${card.title} to ${COLUMN_DEFS.find(item => item.id === column).label}, position ${position + 1}.`);
  } catch (error) { showBoardError(error.message); await refreshKeepingError(error.message); }
  finally { setBusy(false); }
}

async function refreshKeepingError(message) {
  await refresh();
  showBoardError(message);
}

function clearErrors() {
  $('form-error').hidden = true;
  $('form-error').textContent = '';
  for (const field of ['title', 'description', 'assignee', 'column', 'position']) {
    $(`${field}-error`).textContent = '';
    $(field).removeAttribute('aria-invalid');
  }
}

function formError(error) {
  clearErrors();
  $('form-error').textContent = error.message;
  $('form-error').hidden = false;
  // board.validation v1 specifies a literal error string, not a field map.
  $('form-error').focus();
}

function positionOptions(selected) {
  const destination = orderedCards(cards, $('column').value).filter(card => card.id !== editing?.id);
  const options = [];
  for (let index = 0; index <= destination.length; index++) {
    const label = index === destination.length ? `${index + 1} · Last` : `${index + 1} · Before ${destination[index].title}`;
    options.push(new Option(label, String(index)));
  }
  $('position').replaceChildren(...options);
  $('position').value = String(Math.min(selected ?? destination.length, destination.length));
}

function openEditor(id, column = COLUMN_DEFS[0].id) {
  if (busy || !loaded) return;
  returnFocus = document.activeElement;
  editing = id ? { ...cards.find(card => card.id === id) } : null;
  if (id && !editing?.id) { showBoardError('That card was removed by a teammate.'); return; }
  form.reset();
  clearErrors();
  $('delete-confirmation').hidden = true;
  $('dialog-title').textContent = editing ? 'Edit card' : 'New card';
  $('save-card').textContent = editing ? 'Save changes' : 'Create card';
  $('delete-card').hidden = !editing;
  $('position-field').hidden = !editing;
  $('title').value = editing?.title ?? '';
  $('description').value = editing?.description ?? '';
  $('assignee').value = editing?.assignee ?? '';
  $('column').replaceChildren(...COLUMN_DEFS.map(item => new Option(item.label, item.id)));
  $('column').value = editing?.column ?? column;
  positionOptions(editing?.position);
  dialog.showModal();
  $('title').focus();
}

function closeEditor() { if (!busy) dialog.close(); }
function restoreEditorFocus() {
  if (busy) { restoreFocusPending = true; return; }
  restoreFocusPending = false;
  if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus();
  else $('new-card').focus();
}
function setBusy(value) {
  busy = value;
  form.setAttribute('aria-busy', String(value));
  for (const control of form.querySelectorAll('input, textarea, select, button')) control.disabled = value;
  $('new-card').disabled = value || !loaded;
  for (const article of board.querySelectorAll('.card')) article.draggable = !value;
  if (!value && restoreFocusPending && !dialog.open) restoreEditorFocus();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  clearErrors();
  const fields = { title: $('title').value, description: $('description').value, assignee: $('assignee').value };
  const column = $('column').value;
  const position = Number($('position').value);
  setBusy(true);
  try {
    if (editing) {
      if (column !== editing.column || position !== editing.position) Object.assign(fields, { column, position });
      await api.update(editing.id, fields);
    } else await api.create({ ...fields, column });
    announce(editing ? 'Card updated.' : 'Card created.');
    dialog.close();
    await refresh();
  } catch (error) { setBusy(false); formError(error); }
  finally { setBusy(false); }
});

$('confirm-delete').addEventListener('click', async () => {
  if (busy || !editing) return;
  setBusy(true);
  clearErrors();
  try {
    await api.remove(editing.id);
    dialog.close();
    announce('Card deleted.');
    await refresh();
  } catch (error) { setBusy(false); formError(error); }
  finally { setBusy(false); }
});

$('delete-card').addEventListener('click', () => { $('delete-confirmation').hidden = false; $('confirm-delete').focus(); });
$('cancel-delete').addEventListener('click', () => { $('delete-confirmation').hidden = true; $('delete-card').focus(); });
$('new-card').addEventListener('click', () => openEditor(null));
$('close-dialog').addEventListener('click', closeEditor);
$('cancel-dialog').addEventListener('click', closeEditor);
$('column').addEventListener('change', () => positionOptions());
$('retry').addEventListener('click', () => { restartStream(); refresh(); });
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
dialog.addEventListener('close', restoreEditorFocus);
for (const field of ['title', 'description', 'assignee', 'column', 'position']) $(field).addEventListener('input', () => {
  $(`${field}-error`).textContent = '';
  $(field).removeAttribute('aria-invalid');
});

let stopStream;
function restartStream() {
  stopStream?.();
  streamConnected = false;
  connectionStatus();
  stopStream = subscribe({
    change: refresh,
    connected() { streamConnected = true; connectionStatus(); refresh(); },
    disconnected() { streamConnected = false; connectionStatus(); },
  });
}
// Connect before reading the snapshot. Every reconnect also reloads the full
// snapshot because events may have been missed while offline.
setBusy(false);
restartStream();
refresh();
window.addEventListener('online', () => { restartStream(); refresh(); });
window.addEventListener('pagehide', () => stopStream?.());
window.addEventListener('pageshow', event => { if (event.persisted) { restartStream(); refresh(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
