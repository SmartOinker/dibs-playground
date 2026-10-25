import { createApi, subscribe, createRefreshQueue } from './api.mjs';
import { COLUMN_LABELS, cardsInColumn, dropPosition, initials } from './board-model.mjs';

const $ = id => document.getElementById(id);
const api = createApi();
const board = $('board');
const editor = $('card-dialog');
const deletion = $('delete-dialog');
const form = $('card-form');
let cards = [];
let columns = [];
let edited = null;
let busy = false;
let draggedId = null;
let loaded = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function announce(message) { $('announcement').textContent = message; }
function showBoardError(error) {
  $('board-error-text').textContent = error.message;
  $('board-error').hidden = false;
}
function connection(state) {
  $('connection').dataset.state = state;
  $('connection-text').textContent = state === 'live' ? 'Live updates' : state === 'offline' ? 'Reconnecting…' : 'Connecting…';
}

function render() {
  const focused = document.activeElement?.dataset.cardId;
  board.replaceChildren();
  columns.forEach((id, index) => {
    const section = element('section', 'column');
    section.dataset.column = id;
    section.style.setProperty('--column-color', ['#a5a99c', '#c9a143', '#72917a'][index % 3]);
    section.setAttribute('aria-labelledby', `heading-${id}`);
    const header = element('div', 'column-header');
    const marker = element('span', 'column-marker');
    marker.setAttribute('aria-hidden', 'true');
    const heading = element('h2', '', COLUMN_LABELS[id] || id);
    heading.id = `heading-${id}`;
    const group = cardsInColumn(cards, id);
    const count = element('span', 'column-count', String(group.length));
    count.setAttribute('aria-label', `${group.length} cards`);
    const add = element('button', 'column-add', '+');
    add.type = 'button';
    add.setAttribute('aria-label', `Add card to ${COLUMN_LABELS[id] || id}`);
    add.addEventListener('click', () => openEditor(null, id));
    header.append(marker, heading, count, add);
    const list = element('div', 'card-list');
    group.forEach(card => list.append(renderCard(card)));
    if (!group.length) list.append(element('p', 'empty-column', 'A little room for what’s next.\nDrop a card here or add one above.'));
    section.append(header, list);
    section.addEventListener('dragover', event => dragOver(event, section));
    section.addEventListener('dragleave', event => {
      if (!section.contains(event.relatedTarget)) clearDropMarks();
    });
    section.addEventListener('drop', event => drop(event, section));
    board.append(section);
  });
  $('card-total').textContent = `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} · ${columns.length} columns`;
  board.setAttribute('aria-busy', 'false');
  $('new-card').disabled = false;
  if (focused) [...board.querySelectorAll('.card-open')].find(node => node.dataset.cardId === focused)?.focus();
}

function renderCard(card) {
  const article = element('article', 'card');
  article.draggable = true;
  article.dataset.cardId = card.id;
  const open = element('button', 'card-open');
  open.type = 'button';
  // Interactive elements suppress ancestor dragging in Chromium unless explicit.
  open.draggable = true;
  open.dataset.cardId = card.id;
  open.setAttribute('aria-label', `Edit ${card.title}`);
  open.append(element('h3', 'card-title', card.title));
  if (card.description) open.append(element('p', 'card-description', card.description));
  const footer = element('div', 'card-footer');
  if (card.assignee) {
    const avatar = element('span', 'avatar', initials(card.assignee));
    avatar.setAttribute('aria-hidden', 'true');
    footer.append(avatar, element('span', 'assignee-name', card.assignee));
  } else footer.append(element('span', 'unassigned', 'Unassigned'));
  open.append(footer);
  open.addEventListener('click', () => openEditor(card));
  article.append(open);
  article.addEventListener('dragstart', event => {
    if (busy) { event.preventDefault(); return; }
    draggedId = card.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.id);
    article.classList.add('dragging');
  });
  article.addEventListener('dragend', () => {
    draggedId = null;
    article.classList.remove('dragging');
    clearDropMarks();
    render();
  });
  return article;
}

const refresh = createRefreshQueue(async () => {
  const next = await api.list();
  cards = next;
  loaded = true;
  // Keep DOM stable during native dragging; drop uses this fresh card state.
  if (!draggedId) render();
  $('board-error').hidden = true;
});

async function safeRefresh() {
  try { await refresh(); } catch (error) {
    board.setAttribute('aria-busy', 'false');
    if (!loaded) board.replaceChildren(element('p', 'loading', 'Your board will appear when the server is available.'));
    showBoardError(error);
  }
}

function clearErrors() {
  $('form-error').hidden = true;
  for (const name of ['title', 'description', 'assignee', 'column', 'position']) {
    $(`${name}-error`).hidden = true;
    $(name).removeAttribute('aria-invalid');
  }
}

function showFormError(error) {
  $('form-error').textContent = error.message;
  $('form-error').hidden = false;
  let first;
  for (const [name, message] of Object.entries(error.fields || {})) {
    const target = $(`${name}-error`);
    if (!target || typeof message !== 'string') continue;
    target.textContent = message;
    target.hidden = false;
    $(name).setAttribute('aria-invalid', 'true');
    first ||= $(name);
  }
  first?.focus();
}

function updatePositions(selected) {
  const siblings = cardsInColumn(cards, $('column').value, edited?.id);
  $('position').replaceChildren(...Array.from({ length: siblings.length + 1 }, (_, index) => {
    const option = element('option', '', index === 0 ? '1 · Top' : index === siblings.length ? `${index + 1} · Bottom` : String(index + 1));
    option.value = String(index);
    return option;
  }));
  $('position').value = String(Math.min(selected ?? siblings.length, siblings.length));
}

function openEditor(card, column = columns[0]) {
  if (busy) return;
  edited = card ? { ...card } : null;
  form.reset();
  clearErrors();
  $('dialog-title').textContent = card ? 'Edit card' : 'New card';
  $('save-card').textContent = card ? 'Save changes' : 'Create card';
  $('delete-card').hidden = !card;
  $('position-field').hidden = !card;
  for (const name of ['title', 'description', 'assignee']) $(name).value = card?.[name] || '';
  $('column').value = card?.column || column;
  updatePositions(card?.position);
  editor.showModal();
  $('title').focus();
}

function setBusy(value) {
  busy = value;
  for (const control of [...form.elements, ...$('delete-form').elements]) control.disabled = value;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  clearErrors();
  const values = Object.fromEntries(['title', 'description', 'assignee'].map(name => [name, $(name).value]));
  if (!edited) values.column = $('column').value;
  else if ($('column').value !== edited.column || Number($('position').value) !== edited.position) {
    values.column = $('column').value;
    values.position = Number($('position').value);
  }
  setBusy(true);
  try {
    if (edited) await api.update(edited.id, values);
    else await api.create(values);
    editor.close();
    announce(edited ? 'Card updated.' : 'Card created.');
    await safeRefresh();
  } catch (error) { setBusy(false); showFormError(error); }
  finally { setBusy(false); }
});

$('delete-card').addEventListener('click', () => {
  $('delete-error').hidden = true;
  deletion.showModal();
});
$('delete-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !edited) return;
  $('delete-error').hidden = true;
  setBusy(true);
  try {
    await api.remove(edited.id);
    deletion.close();
    editor.close();
    announce('Card deleted.');
    await safeRefresh();
  } catch (error) {
    $('delete-error').textContent = error.message;
    $('delete-error').hidden = false;
  } finally { setBusy(false); }
});

function beforeCard(event, section) {
  return [...section.querySelectorAll('.card')].filter(node => node.dataset.cardId !== draggedId)
    .find(node => event.clientY < node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2);
}

function clearDropMarks() {
  board.querySelectorAll('.drag-over,.drop-before,.drop-at-end').forEach(node => node.classList.remove('drag-over', 'drop-before', 'drop-at-end'));
}

function dragOver(event, section) {
  if (!draggedId || busy) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  section.classList.add('drag-over');
  const before = beforeCard(event, section);
  if (before) before.classList.add('drop-before');
  else section.classList.add('drop-at-end');
}

async function drop(event, section) {
  if (!draggedId || busy) return;
  event.preventDefault();
  const id = draggedId;
  const card = cards.find(item => item.id === id);
  const column = section.dataset.column;
  const position = dropPosition(cards, column, id, beforeCard(event, section)?.dataset.cardId);
  clearDropMarks();
  draggedId = null;
  if (!card || (card.column === column && card.position === position)) { render(); return; }
  setBusy(true);
  let moveError;
  try {
    await api.move(id, column, position);
    announce(`Moved ${card.title} to ${COLUMN_LABELS[column]}, position ${position + 1}.`);
  } catch (error) { moveError = error; }
  finally { setBusy(false); }
  // A failed move must keep its error visible after reloading server state.
  try { await refresh(); } catch (error) { showBoardError(error); }
  if (moveError) showBoardError(moveError);
}

$('new-card').addEventListener('click', () => openEditor(null));
$('column').addEventListener('change', () => updatePositions());
$('close-dialog').addEventListener('click', () => editor.close());
$('cancel').addEventListener('click', () => editor.close());
$('cancel-delete').addEventListener('click', () => deletion.close());
for (const dialog of [editor, deletion]) dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('retry').addEventListener('click', safeRefresh);
window.addEventListener('online', safeRefresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) safeRefresh(); });

function start() {
  if (!window.Cards?.COLUMNS) {
    showBoardError(new Error('Shared board settings could not load. Reload the page to try again.'));
    $('retry').onclick = () => location.reload();
    board.setAttribute('aria-busy', 'false');
    return;
  }
  columns = [...window.Cards.COLUMNS];
  $('title').placeholder = `What needs to happen? (${window.Cards.TITLE_MAX} characters max)`;
  $('column').replaceChildren(...columns.map(id => {
    const option = element('option', '', COLUMN_LABELS[id] || id);
    option.value = id;
    return option;
  }));
  safeRefresh();
  const unsubscribe = subscribe(() => { safeRefresh(); }, connection);
  window.addEventListener('pagehide', unsubscribe, { once: true });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
}
// Deferred shared script has executed before DOMContentLoaded.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
