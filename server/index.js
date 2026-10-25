const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { COLUMNS, LABEL_COLORS, newId, validateCard } = require('../shared/cards');

const WEB_DIR = path.join(__dirname, '..', 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

// WIP limits are enforced by the store only (agreed board.limits); the server relays
// store.limits and maps the store's VALIDATION_ERROR to HTTP 400.
function createServer(store) {
  const clients = new Set();

  const toCard = (c) => ({ description: '', assignee: '', labels: [], ...c });
  const allCards = async () => (await store.list()).map(toCard);

  // Serialise mutations so multi-step writes (move + update) do not interleave.
  let lock = Promise.resolve();
  const exclusive = (fn) => {
    const run = lock.then(fn);
    lock = run.catch(() => {});
    return run;
  };

  async function broadcast() {
    const msg = `event: cards\ndata: ${JSON.stringify(await allCards())}\n\n`;
    for (const res of clients) res.write(msg);
  }

  function send(res, status, body) {
    if (body === undefined) {
      res.writeHead(status).end();
      return;
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function readJson(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch {
          resolve(null);
        }
      });
    });
  }

  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(WEB_DIR, rel);
    if (!file.startsWith(WEB_DIR + path.sep)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`event: snapshot\ndata: ${JSON.stringify(await allCards())}\n\n`);
      clients.add(res);
      const beat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      req.on('close', () => {
        clearInterval(beat);
        clients.delete(res);
      });
      return;
    }

    if (pathname === '/api/board' && req.method === 'GET') {
      return send(res, 200, { columns: COLUMNS, cards: await allCards(), limits: store.limits, labelColors: LABEL_COLORS });
    }

    if (pathname === '/api/cards') {
      if (req.method === 'GET') return send(res, 200, await allCards());
      if (req.method === 'POST') {
        const v = validateCard(await readJson(req));
        if (!v.ok) return send(res, 400, { error: v.error, errors: v.errors });
        const { title, column, position, description, assignee, labels } = v.value;
        return exclusive(async () => {
          const card = await store.create({ id: newId(), title, description, assignee, labels, column, position });
          await broadcast();
          return send(res, 201, toCard(card));
        });
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    const m = pathname.match(/^\/api\/cards\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (req.method === 'PATCH') {
        const v = validateCard(await readJson(req), { partial: true });
        if (!v.ok) return send(res, 400, { error: v.error, errors: v.errors });
        return exclusive(async () => {
          let card = await store.get(id);
          if (!card) return send(res, 404, { error: 'card not found' });
          const { title, column, position, description, assignee, labels } = v.value;
          const patch = JSON.parse(JSON.stringify({ title, description, assignee, labels }));
          // Move first: if the store rejects it (WIP limit), nothing has changed yet.
          if (column !== undefined || position !== undefined) {
            card = (await store.move(id, column ?? card.column, position ?? card.position)) || card;
          }
          if (Object.keys(patch).length) card = (await store.update(id, patch)) || card;
          await broadcast();
          return send(res, 200, toCard(card));
        });
      }
      if (req.method === 'DELETE') {
        if (!(await store.remove(id))) return send(res, 404, { error: 'card not found' });
        await broadcast();
        return send(res, 204);
      }
      return send(res, 405, { error: 'method not allowed' });
    }

    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    serveStatic(res, pathname);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err && err.code === 'VALIDATION_ERROR' && !res.headersSent) {
        return send(res, 400, { error: err.message, errors: err.errors });
      }
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
}

async function main() {
  const mod = await import('../store/index.js');
  const createStore = mod.createStore || mod.default;
  const store = await createStore({ filePath: path.join(__dirname, '..', 'store', 'data.json') });
  createServer(store).listen(3000, () => console.log('board on http://localhost:3000'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createServer };
