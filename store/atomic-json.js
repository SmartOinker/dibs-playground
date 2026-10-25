'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function replaceFile(source, target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      // Windows readers and virus scanners can briefly block replacement.
      const transient = error.code === 'EBUSY' ||
        (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code));
      if (!transient || attempt === 6) throw error;
      await delay(10 * 2 ** attempt);
    }
  }
}

async function readJson(filePath) {
  let source;
  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  return JSON.parse(source);
}

async function writeJson(filePath, value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError('Board must be JSON serializable');
  }

  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle;
  let ownsTemporary = false;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    await handle.writeFile(`${serialized}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Same-directory rename publishes either the old complete file or the new one.
    await replaceFile(temporary, filePath);
    ownsTemporary = false;
  } finally {
    try {
      if (handle) await handle.close();
    } finally {
      if (ownsTemporary) await fs.rm(temporary, { force: true });
    }
  }
}

module.exports = { readJson, writeJson };
