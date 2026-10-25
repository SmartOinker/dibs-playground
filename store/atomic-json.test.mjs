import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeJson } from './atomic-json.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'board-atomic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('atomically creates and replaces JSON, without temporary files', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = join(directory, 'nested', 'board.json');
  await writeJson(file, { cards: [] });
  await writeJson(file, { cards: [{ title: 'Saved' }] });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    cards: [{ title: 'Saved' }],
  });
  assert.deepEqual(await readdir(join(directory, 'nested')), ['board.json']);
});

test('serialization failure leaves the previous file intact', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = join(directory, 'board.json');
  await writeJson(file, { cards: [] });
  const circular = {};
  circular.self = circular;
  await assert.rejects(writeJson(file, circular), TypeError);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { cards: [] });
  assert.deepEqual(await readdir(directory), ['board.json']);
});

test('a failed replacement cleans up its temporary file', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = join(directory, 'board.json');
  await mkdir(file);
  await assert.rejects(writeJson(file, { cards: [] }));
  assert.deepEqual(await readdir(directory), ['board.json']);
});
