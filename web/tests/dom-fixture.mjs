// A small DOM test double for exercising app event handlers in node:test.
// This is not a browser/layout engine; visual QA still needs a real browser.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createApi, subscribe, COLUMN_DEFS } from '../api.mjs';
import * as helpers from '../board.mjs';

class Node {
  constructor(tag, document) {
    Object.assign(this, { tagName: tag.toUpperCase(), ownerDocument: document, children: [], parentNode: null, dataset: {}, attributes: {}, listeners: {}, value: '', hidden: false, disabled: false, open: false, className: '', text: '' });
    this.style = { setProperty() {} };
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' ').trim(); },
      remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
    };
  }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
  set textContent(text) { this.text = String(text); this.children = []; }
  get isConnected() { return Boolean(this.parentNode) || Boolean(this.id); }
  append(...nodes) {
    for (let node of nodes) {
      if (typeof node === 'string') node = this.ownerDocument.createTextNode(node);
      if (node.tagName === '#FRAGMENT') { this.append(...node.children.slice()); continue; }
      node.remove(); node.parentNode = this; this.children.push(node);
    }
  }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = ''; this.append(...nodes); }
  insertBefore(node, before) {
    node.remove();
    if (!before) { this.append(node); return; }
    const index = this.children.indexOf(before);
    if (index < 0) throw new Error('insertBefore target is not a child');
    node.parentNode = this;
    this.children.splice(index, 0, node);
  }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  async emit(name, props = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...props };
    for (const listener of this.listeners[name] || []) await listener(event);
    return event;
  }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  matches(selector) { return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : this.tagName === selector.toUpperCase(); }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector); }
  contains(other) { return other === this || this.children.some(node => node.contains(other)); }
  querySelectorAll(selectors) {
    const matches = [];
    const selectorsList = selectors.split(',').map(value => value.trim());
    for (const node of this.children) {
      if (selectorsList.some(selector => node.matches(selector))) matches.push(node);
      matches.push(...node.querySelectorAll(selectors));
    }
    return matches;
  }
  getBoundingClientRect() { return { top: this.testTop ?? 0, height: 100 }; }
  showModal() { this.open = true; }
  close() { this.open = false; return this.emit('close'); }
  reset() { for (const input of this.querySelectorAll('input,textarea,select')) input.value = ''; }
}

export async function startApp(fetcher) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const nodes = new Map();
  const document = new Node('#document');
  document.ownerDocument = document;
  document.activeElement = document;
  document.createElement = tag => new Node(tag, document);
  document.createDocumentFragment = () => new Node('#fragment', document);
  document.createTextNode = text => { const node = new Node('#text', document); node.textContent = text; return node; };
  document.getElementById = id => nodes.get(id);
  for (const match of html.matchAll(/<([a-z0-9]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Node(match[1], document);
    node.id = match[2];
    node.hidden = /\bhidden\b/.test(match[0]);
    nodes.set(node.id, node);
    document.append(node);
  }
  const $ = id => nodes.get(id);
  for (const field of ['title', 'description', 'assignee', 'column', 'position', 'save-card', 'delete-card', 'confirm-delete', 'cancel-delete', 'close-dialog', 'cancel-dialog']) $('card-form').append($(field));
  $('card-dialog').append($('card-form'));
  const streams = [];
  class EventSource {
    constructor(path) { this.path = path; this.listeners = {}; streams.push(this); }
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
    emit(name) { for (const listener of this.listeners[name] || []) listener({ data: '{}' }); }
    close() { this.closed = true; }
  }
  const window = new Node('#window', document);
  const context = vm.createContext({
    document, window, console,
    Option: function Option(text, value) { const node = new Node('option', document); node.textContent = text; node.value = value; return node; },
    COLUMN_DEFS, api: createApi(fetcher), subscribe: callbacks => subscribe(callbacks, EventSource), ...helpers,
  });
  const source = (await readFile(new URL('../app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  vm.runInContext(source, context, { filename: 'web/app.js' });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return { $, document, window, streams, settle, columns: () => $('board').querySelectorAll('.column'), cards: () => $('board').querySelectorAll('.card') };
}

export function fixtureCard(id, column = 'todo', position = 0, extra = {}) {
  return { id, title: `Task ${id}`, description: '', assignee: '', column, position, ...extra };
}

export function fakeServer(initial = []) {
  let cards = structuredClone(initial);
  const calls = [];
  let failure;
  const renumber = () => {
    for (const { id } of COLUMN_DEFS) helpers.orderedCards(cards, id).forEach((card, position) => { card.position = position; });
  };
  return {
    calls,
    get cards() { return cards; },
    set cards(value) { cards = structuredClone(value); },
    failNext(status, message) { failure = { status, message }; },
    async fetch(path, options) {
      const body = options.body && JSON.parse(options.body);
      calls.push({ path, method: options.method, body });
      if (failure) { const { status, message } = failure; failure = null; return Response.json({ error: message }, { status }); }
      if (options.method === 'GET') return Response.json(cards);
      if (options.method === 'POST') {
        if (!body.title.trim()) return Response.json({ error: 'title: A title is required.' }, { status: 400 });
        const card = fixtureCard(`new-${calls.length}`, body.column, cards.filter(card => card.column === body.column).length, body);
        cards.push(card);
        return Response.json(card, { status: 201 });
      }
      const id = decodeURIComponent(path.split('/').at(-1));
      const card = cards.find(card => card.id === id);
      if (!card) return Response.json({ error: 'Card not found' }, { status: 404 });
      if (options.method === 'DELETE') { cards = cards.filter(item => item.id !== id); renumber(); return new Response(null, { status: 204 }); }
      if (body.column !== undefined || body.position !== undefined) {
        const destinationColumn = body.column ?? card.column;
        const destination = helpers.orderedCards(cards, destinationColumn).filter(item => item.id !== id);
        destination.splice(Math.min(body.position ?? destination.length, destination.length), 0, card);
        card.column = destinationColumn;
        destination.forEach((item, position) => { item.position = position; });
      }
      for (const field of ['title', 'description', 'assignee']) if (body[field] !== undefined) card[field] = body[field];
      renumber();
      return Response.json(card);
    },
  };
}
