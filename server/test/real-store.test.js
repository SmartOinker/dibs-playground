'use strict';

// End-to-end through Droid's store/index.js. Skipped until it is present.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { start } = require('../index');
const { request, subscribe } = require('./helpers');

const hasStore = fs.existsSync(path.join(__dirname, '..', '..', 'store', 'index.js'));

test('works end to end on the real store', { skip: !hasStore && 'store/index.js not present yet' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-store-'));
  const filePath = path.join(dir, 'board.json');
  const server = await start({ port: 0, filePath });
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stream = await subscribe(base);
  t.after(() => stream.close());

  const a = (await request(base, 'POST', '/api/cards', { title: 'a' })).body;
  const b = (await request(base, 'POST', '/api/cards', { title: 'b' })).body;
  assert.deepEqual([a.position, b.position], [0, 1]);

  const moved = await request(base, 'PATCH', `/api/cards/${b.id}`, { column: 'in-progress', position: 0 });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.body.column, moved.body.position], ['in-progress', 0]);
  assert.equal((await request(base, 'PATCH', `/api/cards/${a.id}`, { title: 'A' })).body.title, 'A');
  assert.equal((await request(base, 'DELETE', `/api/cards/${a.id}`)).status, 204);
  assert.equal((await request(base, 'GET', `/api/cards/${a.id}`)).status, 404);

  const events = await stream.next(5);
  assert.deepEqual(events.map((e) => e.event),
    ['card.created', 'card.created', 'card.moved', 'card.updated', 'card.deleted']);

  const list = (await request(base, 'GET', '/api/cards')).body;
  assert.deepEqual(list.map((c) => c.id), [b.id]);
  assert.ok(fs.existsSync(filePath), 'store persisted the board');
});
