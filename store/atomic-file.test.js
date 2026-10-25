import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readJson, writeJsonAtomic } from './atomic-file.js';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'board-atomic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('reads missing files without hiding invalid JSON or I/O errors', async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, 'board.json');
  assert.equal(await readJson(filePath), undefined);
  await fs.writeFile(filePath, '{"broken":');
  await assert.rejects(readJson(filePath), SyntaxError);
  await assert.rejects(readJson(directory));
});

test('creates parent directories and atomically replaces a JSON file', async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, 'nested', 'board.json');
  await writeJsonAtomic(filePath, { cards: [] });
  await writeJsonAtomic(filePath, { cards: [{ title: 'Keep me' }] });
  assert.deepEqual(await readJson(filePath), { cards: [{ title: 'Keep me' }] });
  assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['board.json']);
});

test('serialization failure preserves the original file', async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, 'board.json');
  await writeJsonAtomic(filePath, { original: true });
  const cycle = {};
  cycle.self = cycle;
  await assert.rejects(writeJsonAtomic(filePath, cycle), TypeError);
  await assert.rejects(writeJsonAtomic(filePath, undefined), TypeError);
  assert.deepEqual(await readJson(filePath), { original: true });
  assert.deepEqual(await fs.readdir(directory), ['board.json']);
});

test('rename failure preserves the old board and removes the temporary file', async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, 'board.json');
  await writeJsonAtomic(filePath, { original: true });
  const failure = Object.assign(new Error('Simulated rename failure'), { code: 'EIO' });
  const rename = t.mock.method(fs, 'rename', async () => { throw failure; });
  await assert.rejects(writeJsonAtomic(filePath, { original: false }), failure);
  rename.mock.restore();
  assert.deepEqual(await readJson(filePath), { original: true });
  assert.deepEqual(await fs.readdir(directory), ['board.json']);
  await writeJsonAtomic(filePath, { recovered: true });
  assert.deepEqual(await readJson(filePath), { recovered: true });
});

test('file contents are flushed and closed before replacement', async (t) => {
  const directory = await fixture(t);
  const filePath = path.join(directory, 'board.json');
  const operations = [];
  const open = fs.open;
  const rename = fs.rename;
  t.mock.method(fs, 'open', async (...args) => {
    assert.equal(args[1], 'wx');
    const handle = await open(...args);
    return {
      writeFile: async (...writeArgs) => {
        operations.push('write');
        return handle.writeFile(...writeArgs);
      },
      sync: async () => {
        operations.push('sync');
        return handle.sync();
      },
      close: async () => {
        operations.push('close');
        return handle.close();
      },
    };
  });
  t.mock.method(fs, 'rename', async (...args) => {
    operations.push('rename');
    assert.equal(path.dirname(args[0]), path.dirname(args[1]));
    return rename(...args);
  });
  await writeJsonAtomic(filePath, { cards: [] });
  assert.deepEqual(operations, ['write', 'sync', 'close', 'rename']);
});

test('write and flush failures keep the previous snapshot and clean up', async (t) => {
  for (const phase of ['writeFile', 'sync']) {
    await t.test(phase, async (t) => {
      const directory = await fixture(t);
      const filePath = path.join(directory, 'board.json');
      await writeJsonAtomic(filePath, { original: true });
      const open = fs.open;
      const failure = Object.assign(new Error(`Simulated ${phase} failure`), { code: 'EIO' });
      const mocked = t.mock.method(fs, 'open', async (...args) => {
        const handle = await open(...args);
        return {
          writeFile: async (...writeArgs) => {
            if (phase === 'writeFile') throw failure;
            return handle.writeFile(...writeArgs);
          },
          sync: async () => {
            if (phase === 'sync') throw failure;
            return handle.sync();
          },
          close: () => handle.close(),
        };
      });
      await assert.rejects(writeJsonAtomic(filePath, { original: false }), failure);
      mocked.mock.restore();
      assert.deepEqual(await readJson(filePath), { original: true });
      assert.deepEqual(await fs.readdir(directory), ['board.json']);
    });
  }
});
