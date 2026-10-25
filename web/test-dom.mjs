// Small DOM fixture for the board's rendering and event handlers; no dependencies.
export function installDom(t) {
  const previous = globalThis.document;
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.listeners = {};
      this.className = '';
      this._text = '';
      this.style = { setProperty: (name, value) => { this.style[name] = value; } };
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
      };
    }
    set textContent(text) { this._text = String(text); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      if (selector === '[data-focus-key]') return this.dataset.focusKey !== undefined;
      return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      const matches = node => selector.split(',').some(part => node.matches(part.trim()));
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    closest(selector) { return selector.split(',').some(part => this.matches(part.trim())) ? this : this.parent?.closest(selector); }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    fire(type, fields = {}) {
      const event = { target: this, dataTransfer: { setData() {} }, clientY: 10000, preventDefault() { this.defaultPrevented = true; }, ...fields };
      for (const callback of this.listeners[type] || []) callback(event);
      return event;
    }
    getBoundingClientRect() { return { top: 0, height: 80 }; }
    focus() { document.activeElement = this; }
  }
  globalThis.document = { createElement: tag => new Node(tag), activeElement: null };
  t.after(() => { globalThis.document = previous; });
  return document.createElement('div');
}
