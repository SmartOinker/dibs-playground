'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const { readJson, writeJson } = require('./atomic-json');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'board-atomic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('creates parent directories and replaces a complete JSON document', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, 'nested', 'board.json');
  assert.equal(await readJson(file), undefined);
  await writeJson(file, { cards: [] });
  assert.deepEqual(await readJson(file), { cards: [] });
  const board = { cards: [{ id: 'example', title: 'Café' }] };
  await writeJson(file, board);
  assert.deepEqual(await readJson(file), board);
  assert.deepEqual(await fs.readdir(path.dirname(file)), ['board.json']);
});

test('does not treat malformed JSON as an empty board', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, 'board.json');
  await fs.writeFile(file, '{"cards":');
  await assert.rejects(readJson(file), SyntaxError);
  assert.equal(await fs.readFile(file, 'utf8'), '{"cards":');
});

test('serialization failures preserve existing data', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, 'board.json');
  await writeJson(file, { cards: [] });
  const circular = {};
  circular.self = circular;
  await assert.rejects(writeJson(file, circular), TypeError);
  await assert.rejects(writeJson(file, undefined), TypeError);
  assert.deepEqual(await readJson(file), { cards: [] });
  assert.deepEqual(await fs.readdir(directory), ['board.json']);
});

test('an exclusive-open collision never removes a file owned by another writer', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, 'board.json');
  await writeJson(file, { cards: [] });
  let collision;
  t.mock.method(fs, 'open', async (temporary) => {
    collision = temporary;
    await fs.writeFile(temporary, 'another writer');
    throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
  });
  await assert.rejects(writeJson(file, { cards: [{ id: 'new' }] }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(collision, 'utf8'), 'another writer');
  assert.deepEqual(await readJson(file), { cards: [] });
});

test('successful rename has no fallible temporary cleanup after its commit point', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, 'board.json');
  const cleanup = t.mock.method(fs, 'rm');
  await writeJson(file, { cards: [] });
  assert.equal(cleanup.mock.callCount(), 0);
  assert.deepEqual(await readJson(file), { cards: [] });
});

test('a failed replacement cleans its temporary file without touching the target', async (t) => {
  const directory = await temporaryDirectory(t);
  const target = path.join(directory, 'board.json');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'sentinel'), 'untouched');
  await assert.rejects(writeJson(target, { cards: [] }));
  assert.equal(await fs.readFile(path.join(target, 'sentinel'), 'utf8'), 'untouched');
  assert.deepEqual(await fs.readdir(directory), ['board.json']);
});

test('readers see only complete snapshots during replacement', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, 'board.json');
  const first = { cards: [], padding: 'a'.repeat(4096) };
  const second = { cards: [{ id: 'second' }], padding: 'b'.repeat(4096) };
  await writeJson(file, first);
  const writes = (async () => {
    for (let index = 0; index < 12; index += 1) {
      await writeJson(file, index % 2 ? first : second);
    }
  })();
  const reads = (async () => {
    for (let index = 0; index < 40; index += 1) {
      const snapshot = await readJson(file);
      assert.ok(
        JSON.stringify(snapshot) === JSON.stringify(first) ||
        JSON.stringify(snapshot) === JSON.stringify(second),
      );
    }
  })();
  await Promise.all([writes, reads]);
});

test('retries a transient replacement lock without removing the old snapshot', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, 'board.json');
  await writeJson(file, { cards: [] });
  const rename = fs.rename;
  let attempts = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    attempts += 1;
    if (attempts === 1) {
      assert.deepEqual(await readJson(file), { cards: [] });
      throw Object.assign(new Error('temporarily locked'), { code: 'EBUSY' });
    }
    return rename(...args);
  });
  await writeJson(file, { cards: [{ id: 'new' }] });
  assert.equal(attempts, 2);
  assert.deepEqual(await readJson(file), { cards: [{ id: 'new' }] });
});

test('write and sync failures leave the committed file intact', async (t) => {
  for (const operation of ['writeFile', 'sync']) {
    await t.test(operation, async (t) => {
      const directory = await temporaryDirectory(t);
      const file = path.join(directory, 'board.json');
      await writeJson(file, { cards: [] });
      const open = fs.open;
      t.mock.method(fs, 'open', async (...args) => {
        const handle = await open(...args);
        t.mock.method(handle, operation, async () => {
          throw Object.assign(new Error('disk write failed'), { code: 'ENOSPC' });
        });
        return handle;
      });
      await assert.rejects(writeJson(file, { cards: [{ id: 'new' }] }), { code: 'ENOSPC' });
      assert.deepEqual(await readJson(file), { cards: [] });
      assert.deepEqual(await fs.readdir(directory), ['board.json']);
    });
  }
});

test('a process exiting before rename preserves the previous board', async (t) => {
  const directory = await temporaryDirectory(t);
  const file = path.join(directory, 'board.json');
  await writeJson(file, { cards: [] });
  const script = `
    const fs = require('node:fs/promises');
    fs.rename = async () => process.exit(99);
    const { writeJson } = require(process.argv[1]);
    writeJson(process.argv[2], { cards: [{ id: 'not-committed' }] })
      .catch(() => process.exit(1));
  `;
  await assert.rejects(
    promisify(execFile)(process.execPath, ['-e', script, require.resolve('./atomic-json'), file]),
    { code: 99 },
  );
  assert.deepEqual(await readJson(file), { cards: [] });
  // A crash can leave a private temporary file, but it is never loaded as the board.
  assert.equal((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp')).length, 1);
});
