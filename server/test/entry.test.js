// Starts the real entry point (server/index.js) in a temp copy of the repo layout and talks to it.
// store/index.js is the real store if present, otherwise a stub that wraps the fake store.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('node server/index.js listens on PORT, persists via store/ and serves web/', async (t) => {
  const tree = await mkdtemp(path.join(tmpdir(), 'board-tree-'));
  t.after(() => rm(tree, { recursive: true, force: true }));
  const filter = (src) => !src.split(path.sep).includes('data');
  await cp(path.join(ROOT, 'server'), path.join(tree, 'server'), { recursive: true, filter });
  await cp(path.join(ROOT, 'shared'), path.join(tree, 'shared'), { recursive: true });
  await mkdir(path.join(tree, 'web'));
  await writeFile(path.join(tree, 'web', 'index.html'), '<h1>board</h1>');
  if (existsSync(path.join(ROOT, 'store', 'index.js'))) {
    await cp(path.join(ROOT, 'store'), path.join(tree, 'store'), { recursive: true });
  } else {
    await mkdir(path.join(tree, 'store'));
    await writeFile(path.join(tree, 'store', 'package.json'), '{ "type": "module" }\n');
    await writeFile(
      path.join(tree, 'store', 'index.js'),
      "import { createFakeStore } from '../server/test/fake-store.js';\n" +
        'export async function createStore() { return createFakeStore(); }\n',
    );
  }

  const boardFile = path.join(tree, 'board.json');
  const child = spawn(process.execPath, [path.join(tree, 'server', 'index.js')], {
    env: { ...process.env, PORT: '0', BOARD_FILE: boardFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));

  const port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /localhost:(\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', (code) => reject(new Error(`server exited with ${code}: ${stderr}`)));
  });
  const base = `http://localhost:${port}`;

  const created = await fetch(`${base}/api/cards`, { method: 'POST', body: JSON.stringify({ title: 'Smoke' }) });
  assert.equal(created.status, 201);
  const card = await created.json();
  const moved = await fetch(`${base}/api/cards/${card.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ column: 'done', position: 0 }),
  });
  assert.equal((await moved.json()).column, 'done');
  assert.deepEqual((await (await fetch(`${base}/api/cards`)).json()).map((c) => c.title), ['Smoke']);
  assert.equal(await (await fetch(base + '/')).text(), '<h1>board</h1>');
  assert.equal((await fetch(base + '/shared/cards.js')).status, 200);
});
