const labels = { todo: 'To do', doing: 'Doing', done: 'Done' };
export const columnLabel = id => labels[id] || id;

export function orderedCards(cards, column) {
  return cards.filter(card => card.column === column).sort((a, b) => a.position - b.position);
}

export function matchesLabel(card, name) {
  return !name || (card.labels || []).some(label => label.name === name);
}

export function columnFull(cards, column, limits) {
  const limit = limits[column];
  return Number.isInteger(limit) && limit >= 0 && orderedCards(cards, column).length >= limit;
}

export function canEnter(cards, id, column, limits) {
  return cards.some(card => card.id === id && card.column === column) || !columnFull(cards, column, limits);
}

// A visible insertion point is translated to the full, unfiltered destination.
export function destinationIndex(cards, id, column, visible, index) {
  const all = orderedCards(cards, column).filter(card => card.id !== id);
  const before = visible.filter(card => card.id !== id)[index];
  return before ? all.findIndex(card => card.id === before.id) : all.length;
}

// Positions are measured after removing the dragged card, including same-column moves.
export function dropIndex(cards, draggedId, pointerY) {
  const remaining = cards.filter(card => card.id !== draggedId);
  const index = remaining.findIndex(card => pointerY < card.top + card.height / 2);
  return index < 0 ? remaining.length : index;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderBoard(root, columns, cards, { move, remove, busy = false, errors = new Map(), labelFilter = '', limits = {}, palette = [] }) {
  const activeKey = root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  let draggedId = null;
  const clearDrop = () => root.querySelectorAll('.drag-over, .drop-before').forEach(node => node.classList.remove('drag-over', 'drop-before'));
  root.replaceChildren();
  for (const column of columns) {
    const allItems = orderedCards(cards, column);
    const items = allItems.filter(card => matchesLabel(card, labelFilter));
    const full = columnFull(cards, column, limits);
    const section = element('section', 'column');
    if (full) section.classList.add('full');
    section.setAttribute('aria-label', columnLabel(column));
    const heading = element('h3', '', columnLabel(column));
    const limit = limits[column];
    const count = Number.isInteger(limit) ? `${allItems.length}/${limit}` : String(allItems.length);
    heading.append(element('span', 'count', `${count}${full ? ' · Full' : ''}`));
    const list = element('div', 'card-list');
    section.append(heading, list);
    root.append(section);
    if (!items.length) list.append(element('p', 'empty', labelFilter ? 'No matching tasks' : 'No tasks yet'));
    for (const [index, card] of items.entries()) {
      const article = element('article', 'card');
      article.dataset.id = card.id;
      article.draggable = !busy;
      article.append(element('h4', '', card.title));
      const badges = element('div', 'card-labels');
      for (const label of card.labels || []) {
        const badge = element('span', 'card-label', label.name);
        // Palette membership keeps arbitrary card data out of CSS values.
        if (palette.includes(label.color)) badge.style.setProperty('--label-color', label.color);
        badges.append(badge);
      }
      if (badges.children.length) article.append(badges);
      if (card.description) article.append(element('p', 'detail', card.description));
      article.append(element('span', 'assignee', card.assignee || 'Unassigned'));
      const controls = element('div', 'card-controls');
      const select = element('select');
      select.setAttribute('aria-label', `Move ${card.title} to column`);
      select.dataset.focusKey = `${card.id}:column`;
      for (const destination of columns) {
        const option = element('option', '', columnLabel(destination));
        option.value = destination;
        option.disabled = !canEnter(cards, card.id, destination, limits);
        select.append(option);
      }
      select.value = column;
      select.disabled = busy;
      select.addEventListener('change', () => {
        const destination = select.value;
        select.value = column;
        if (canEnter(cards, card.id, destination, limits)) move(card.id, destination, orderedCards(cards, destination).length);
      });
      controls.append(select);
      for (const [text, label, action, disabled] of [
        ['↑', `Move ${card.title} up`, () => move(card.id, column, allItems.findIndex(item => item.id === items[index - 1]?.id)), index === 0],
        ['↓', `Move ${card.title} down`, () => move(card.id, column, allItems.findIndex(item => item.id === items[index + 1]?.id)), index === items.length - 1],
        ['Delete', `Delete ${card.title}`, () => remove(card.id), false],
      ]) {
        const button = element('button', text === 'Delete' ? 'delete' : '', text);
        button.type = 'button';
        button.setAttribute('aria-label', label);
        button.dataset.focusKey = `${card.id}:${text}`;
        button.disabled = busy || disabled;
        button.addEventListener('click', action);
        controls.append(button);
      }
      article.append(controls);
      const error = element('p', 'error', errors.get(card.id) || '');
      error.setAttribute('role', 'alert');
      article.append(error);
      article.addEventListener('dragstart', event => {
        if (busy || event.target.closest('button, select')) { event.preventDefault(); return; }
        draggedId = card.id;
        event.dataTransfer.setData('text/plain', card.id);
        event.dataTransfer.effectAllowed = 'move';
        article.classList.add('dragging');
      });
      article.addEventListener('dragend', () => { draggedId = null; article.classList.remove('dragging'); clearDrop(); });
      list.append(article);
    }
    const getPlacement = event => {
      const nodes = [...list.querySelectorAll('.card')].filter(node => node.dataset.id !== draggedId);
      const index = dropIndex(nodes.map(node => ({ id: node.dataset.id, top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })), draggedId, event.clientY);
      return { nodes, index, position: destinationIndex(cards, draggedId, column, items, index) };
    };
    section.addEventListener('dragover', event => {
      if (!draggedId || busy || !canEnter(cards, draggedId, column, limits)) { clearDrop(); return; }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearDrop();
      section.classList.add('drag-over');
      const { nodes, index } = getPlacement(event);
      nodes[index]?.classList.add('drop-before');
    });
    section.addEventListener('dragleave', event => { if (!section.contains(event.relatedTarget)) clearDrop(); });
    section.addEventListener('drop', event => {
      if (!draggedId || busy || !canEnter(cards, draggedId, column, limits)) { clearDrop(); return; }
      event.preventDefault();
      const { position } = getPlacement(event);
      const card = cards.find(item => item.id === draggedId);
      const samePosition = card.column === column && allItems.findIndex(item => item.id === draggedId) === position;
      clearDrop();
      if (!samePosition) move(draggedId, column, position);
      draggedId = null;
    });
  }
  if (activeKey) [...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === activeKey)?.focus();
}
