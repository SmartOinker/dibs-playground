import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { createTestStore } from './fake-store.js';

// Starts the app on a random port with a fresh in-memory store and a temp web/ dir.
export async function startServer({ store } = {}) {
  store ??= await createTestStore();
  const webDir = await mkdtemp(path.join(tmpdir(), 'board-web-'));
  await writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>Board</title>');
  await writeFile(path.join(webDir, 'app.js'), 'console.log("board");');
  await mkdir(path.join(webDir, 'css'));
  await writeFile(path.join(webDir, 'css', 'styles.css'), 'body{}');

  const app = createApp({ store, webDir });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  async function api(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  async function close() {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    await store.close?.();
    await rm(webDir, { recursive: true, force: true });
  }

  return { base, api, store, app, webDir, close };
}

// Opens /api/events and yields parsed { event, data } frames.
export async function openEvents(base) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const comments = [];

  async function next(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = frame.split('\n');
        if (lines.every((l) => l.startsWith(':'))) {
          comments.push(frame);
          continue;
        }
        const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
        const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
        return { event, data: JSON.parse(data) };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out waiting for SSE event');
      let timer;
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('Timed out waiting for SSE event')), remaining))),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) throw new Error('SSE stream ended');
      buffer += chunk.value;
    }
  }

  // Wait until the server has written its ": connected" comment, so the client is registered.
  while (!buffer.includes(': connected\n\n')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('SSE stream ended');
    buffer += chunk.value;
  }

  return { res, next, comments, close: () => controller.abort() };
}
