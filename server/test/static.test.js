import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.js';

let s;
before(async () => (s = await startServer()));
after(async () => s.close());

// fetch() normalizes "..", so send raw paths with node:http.
function rawGet(path) {
  return new Promise((resolve, reject) => {
    const { port } = new URL(s.base);
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

test('serves web/index.html at /', async () => {
  const res = await fetch(s.base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.match(await res.text(), /<title>Board<\/title>/);
});

test('serves files with the right content types', async () => {
  let res = await fetch(s.base + '/app.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/javascript/);
  res = await fetch(s.base + '/css/styles.css');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/css/);
});

test('missing files are 404 and directories redirect to a trailing slash', async () => {
  assert.equal((await fetch(s.base + '/nope.html')).status, 404);
  const res = await fetch(s.base + '/css', { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/css/');
});

test('does not serve files outside web/', async () => {
  for (const path of ['/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/server/app.js', '/%00']) {
    assert.equal(await rawGet(path), 404, path);
  }
});

test('serves shared/cards.js at /shared/cards.js for the browser', async () => {
  const res = await fetch(s.base + '/shared/cards.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/javascript/);
  assert.match(await res.text(), /export function validateCard/);
  assert.equal((await fetch(s.base + '/shared/package.json')).status, 404);
  assert.equal(await rawGet('/shared/..%2fserver%2fapp.js'), 404);
});

test('non-GET requests outside /api are rejected', async () => {
  assert.equal((await fetch(s.base + '/', { method: 'POST' })).status, 405);
});
