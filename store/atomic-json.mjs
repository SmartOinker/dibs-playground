import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

// The caller serializes writes to a particular destination.
export async function writeJson(filePath, value) {
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(filePath)}.${randomUUID()}.tmp`);
  let handle;
  let created = false;
  try {
    handle = await open(temporary, 'wx', 0o600);
    created = true;
    await handle.writeFile(data, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
  } finally {
    try {
      if (handle) await handle.close();
    } finally {
      if (created) {
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
  }
}
