const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('./index');
const { validateCard } = require('../shared/cards');

// In-memory stand-in implementing the agreed store contract.
function fakeStore() {
  let cards = [];
  const limits = { doing: 5 };
  const checkWip = (column, exceptId) => {
    if (column === 'doing' && cards.filter((c) => c.column === column && c.id !== exceptId).length >= limits.doing) {
      throw Object.assign(new Error("WIP limit reached for column 'doing'"), {
        code: 'VALIDATION_ERROR',
        errors: { column: 'doing column is full' },
      });
    }
  };
  const norm = () => {
    for (const col of ['todo', 'doing', 'done']) {
      cards.filter((c) => c.column === col).forEach((c, i) => (c.position = i));
    }
  };
  return {
    limits,
    async list() { return cards.map((c) => ({ ...c })); },
    async get(id) { const c = cards.find((x) => x.id === id); return c ? { ...c } : null; },
    async create({ id, title, description = '', assignee = '', labels = [], column }) {
      checkWip(column);
      const position = cards.filter((c) => c.column === column).length;
      const card = { id, title, description, assignee, labels, column, position };
      cards.push(card);
      return { ...card };
    },
    async update(id, patch) {
      const c = cards.find((x) => x.id === id);
      if (!c) return null;
      Object.assign(c, patch);
      return { ...c };
    },
    async move(id, column, position) {
      const c = cards.find((x) => x.id === id);
      if (!c) return null;
      if (c.column !== column) checkWip(column, id);
      cards = cards.filter((x) => x !== c);
      const col = cards.filter((x) => x.column === column);
      c.column = column;
      const before = col[Math.min(position, col.length)];
      cards.splice(before ? cards.indexOf(before) : cards.length, 0, c);
      norm();
      return { ...c };
    },
    async remove(id) {
      const n = cards.length;
      cards = cards.filter((c) => c.id !== id);
      norm();
      return cards.length < n;
    },
  };
}

async function withServer(fn) {
  const server = createServer(fakeStore());
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const json = (base, method, url, body) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });

test('validateCard rules', () => {
  assert.deepStrictEqual(validateCard({ title: ' hi ' }).value, {
    title: 'hi', description: '', assignee: '', labels: [], column: 'todo',
  });
  assert.strictEqual(validateCard({ title: '' }).ok, false);
  assert.strictEqual(validateCard({ title: 'x'.repeat(81) }).ok, false);
  assert.strictEqual(validateCard({ title: 'a', column: 'nope' }).ok, false);
  assert.deepStrictEqual(validateCard({ position: 2 }, { partial: true }).value, { position: 2 });
});

test('create, list, move, delete with 404/400 errors', async () => {
  await withServer(async (base) => {
    let res = await json(base, 'POST', '/api/cards', { title: 'A' });
    assert.strictEqual(res.status, 201);
    const a = await res.json();
    assert.strictEqual(a.column, 'todo');
    assert.strictEqual(a.description, '');
    const b = await (await json(base, 'POST', '/api/cards', { title: 'B' })).json();

    res = await json(base, 'PATCH', `/api/cards/${b.id}`, { column: 'doing', position: 0 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).column, 'doing');

    res = await json(base, 'PATCH', `/api/cards/${a.id}`, { assignee: 'sam', title: 'A2' });
    assert.deepStrictEqual(
      [(await res.json()).assignee, (await (await fetch(base + '/api/cards')).json())[0].title],
      ['sam', 'A2'],
    );
    await json(base, 'PATCH', `/api/cards/${a.id}`, { title: 'A' });

    const cards = await (await fetch(base + '/api/cards')).json();
    assert.deepStrictEqual(cards.map((c) => [c.title, c.column]), [['A', 'todo'], ['B', 'doing']]);

    assert.strictEqual((await json(base, 'POST', '/api/cards', { title: '' })).status, 400);
    assert.strictEqual((await json(base, 'PATCH', `/api/cards/${a.id}`, { column: 'x' })).status, 400);
    assert.strictEqual((await json(base, 'PATCH', '/api/cards/nope', { column: 'done', position: 0 })).status, 404);

    assert.strictEqual((await json(base, 'DELETE', `/api/cards/${a.id}`)).status, 204);
    assert.strictEqual((await json(base, 'DELETE', `/api/cards/${a.id}`)).status, 404);
    assert.strictEqual((await (await fetch(base + '/api/board')).json()).cards.length, 1);
  });
});

test('SSE sends snapshot then cards after a mutation', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/api/events');
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const until = async (needle) => {
      while (!buf.includes(needle)) buf += dec.decode((await reader.read()).value);
    };
    await until('event: snapshot\ndata: []\n\n');
    await json(base, 'POST', '/api/cards', { title: 'Live' });
    await until('event: cards');
    assert.match(buf, /"title":"Live"/);
    await reader.cancel();
  });
});

test('labels are accepted, returned, validated', async () => {
  await withServer(async (base) => {
    const bug = { name: 'bug', color: 'red' };
    const a = await (await json(base, 'POST', '/api/cards', {
      title: 'L', labels: [bug, { name: ' ui ', color: 'blue' }, bug],
    })).json();
    assert.deepStrictEqual(a.labels, [bug, { name: 'ui', color: 'blue' }]);
    const p = await (await json(base, 'PATCH', `/api/cards/${a.id}`, { labels: [bug] })).json();
    assert.deepStrictEqual(p.labels, [bug]);
    assert.deepStrictEqual((await (await json(base, 'POST', '/api/cards', { title: 'n' })).json()).labels, []);
    assert.strictEqual((await json(base, 'POST', '/api/cards', { title: 'n', labels: ['bug'] })).status, 400);
    assert.strictEqual((await json(base, 'POST', '/api/cards', { title: 'n', labels: [{ name: 'a', color: 'teal' }] })).status, 400);
    const board = await (await fetch(base + '/api/board')).json();
    assert.ok(board.labelColors.includes('gray'));
  });
});

test('doing column is limited to 5 cards by the store', async () => {
  await withServer(async (base) => {
    assert.deepStrictEqual((await (await fetch(base + '/api/board')).json()).limits, { doing: 5 });
    for (let i = 0; i < 5; i++) {
      assert.strictEqual((await json(base, 'POST', '/api/cards', { title: `d${i}`, column: 'doing' })).status, 201);
    }
    let res = await json(base, 'POST', '/api/cards', { title: 'over', column: 'doing' });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual((await res.json()).errors, { column: 'doing column is full' });
    const t = await (await json(base, 'POST', '/api/cards', { title: 't' })).json();
    res = await json(base, 'PATCH', `/api/cards/${t.id}`, { column: 'doing', position: 0 });
    assert.strictEqual(res.status, 400);
    const doing = (await (await fetch(base + '/api/cards')).json()).filter((c) => c.column === 'doing');
    res = await json(base, 'PATCH', `/api/cards/${doing[4].id}`, { column: 'doing', position: 0 });
    assert.strictEqual(res.status, 200);
    await json(base, 'DELETE', `/api/cards/${doing[0].id}`);
    assert.strictEqual((await json(base, 'PATCH', `/api/cards/${t.id}`, { column: 'doing', position: 0 })).status, 200);
  });
});
