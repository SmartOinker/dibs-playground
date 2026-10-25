'use strict';

const http = require('node:http');
const path = require('node:path');

const { sendJson, readJson } = require('./http');
const { createBoard } = require('./board');
const { createEventHub } = require('./events');
const { createStatic } = require('./static');

const ROOT = path.resolve(__dirname, '..');
const EVENTS = new Set(['card.created', 'card.updated', 'card.moved', 'card.deleted']);

// store: the object from store/index.js createStore() (contract board.store).
// Live updates come from the store's 'change' events, so every durable change
// reaches SSE clients exactly once.
function createApp({ store, webDir = path.join(ROOT, 'web'), sharedDir = path.join(ROOT, 'shared'), heartbeatMs } = {}) {
  if (!store) throw new Error('createApp needs a store');
  const board = createBoard(store);
  const hub = createEventHub({ heartbeatMs });
  const serveStatic = createStatic([
    { prefix: '/shared/', dir: sharedDir },
    { prefix: '/', dir: webDir },
  ]);

  const onChange = ({ type, card } = {}) => {
    if (EVENTS.has(type) && card) hub.send(type, card);
  };
  store.on('change', onChange);

  const routes = [
    ['GET', /^\/api\/cards$/, async () => [200, await board.list()]],
    ['POST', /^\/api\/cards$/, async (req) => [201, await board.create(await readJson(req))]],
    ['GET', /^\/api\/cards\/([^/]+)$/, async (req, id) => [200, await board.get(id)]],
    ['PATCH', /^\/api\/cards\/([^/]+)$/, async (req, id) => [200, await board.patch(id, await readJson(req))]],
    ['DELETE', /^\/api\/cards\/([^/]+)$/, async (req, id) => {
      await board.remove(id);
      return [204];
    }],
  ];

  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/events') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return hub.connect(req, res);
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      let matched = false;
      for (const [method, pattern, fn] of routes) {
        const m = pattern.exec(pathname);
        if (!m) continue;
        matched = true;
        if (method !== req.method) continue;
        const [status, body] = await fn(req, ...m.slice(1).map(decodeURIComponent));
        return sendJson(res, status, body);
      }
      if (matched) return sendJson(res, 405, { error: 'Method not allowed' });
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (await serveStatic(req, res, pathname)) return;
    sendJson(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      let status = err.status || err.statusCode;
      if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
      if (status >= 500) console.error(err);
      if (res.headersSent) return res.end();
      const body = { error: status >= 500 ? 'Internal server error' : err.message || 'Request failed' };
      if (err.details && err.details.fields) body.fields = err.details.fields;
      else if (err.fields) body.fields = err.fields;
      sendJson(res, status, body);
    });
  });
  // Open SSE streams would otherwise keep close() waiting forever.
  const close = server.close.bind(server);
  server.close = (cb) => {
    hub.close();
    if (typeof store.off === 'function') store.off('change', onChange);
    return close(cb);
  };
  server.hub = hub;
  return server;
}

module.exports = { createApp };
