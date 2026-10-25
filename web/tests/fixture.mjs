// An isolated contract fixture. This never imports or replaces teammates' code.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

export async function startFixture() {
  let cards = [];
  let nextId = 0;
  const clients = new Set();
  const requests = [];
  const columns = ['todo', 'in-progress', 'done'];
  const normalize = () => columns.forEach(column => cards.filter(card => card.column === column).sort((a, b) => a.position - b.position).forEach((card, index) => { card.position = index; }));
  const emit = (name, card) => { for (const client of clients) client.write(`event: ${name}\ndata: ${JSON.stringify(card)}\n\n`); };
  function create(input) {
    const card = { id: String(++nextId), title: input.title, description: '', assignee: '', column: 'todo', ...input };
    card.position = cards.filter(item => item.column === card.column).length;
    cards.push(card);
    emit('card.created', card);
    return card;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (path === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (path.startsWith('/api/cards')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : {};
        requests.push({ path, method: req.method, body });
        if (req.method === 'GET') return send(200, cards);
        if (Object.hasOwn(body, 'title') && (!body.title.trim() || body.title.trim().length > 80)) {
          return send(400, { error: 'Please check the card details.', fields: { title: 'Title must contain 1–80 characters.' } });
        }
        if (req.method === 'POST' && path === '/api/cards') return send(201, create(body));
        const card = cards.find(item => item.id === path.split('/').at(-1));
        if (!card) return send(404, { error: 'Not found' });
        if (req.method === 'DELETE') {
          cards = cards.filter(item => item !== card);
          normalize();
          emit('card.deleted', card);
          res.writeHead(204); res.end(); return;
        }
        if (req.method === 'PATCH') {
          const moved = Object.hasOwn(body, 'column');
          if (moved) {
            const siblings = cards.filter(item => item !== card && item.column === body.column).sort((a, b) => a.position - b.position);
            card.column = body.column;
            siblings.splice(Math.min(body.position, siblings.length), 0, card);
            siblings.forEach((item, index) => { item.position = index; });
          }
          for (const name of ['title', 'description', 'assignee']) if (name in body) card[name] = body[name].trim();
          normalize();
          emit(moved ? 'card.moved' : 'card.updated', card);
          return send(200, card);
        }
        return send(405, { error: 'Unsupported method' });
      }
      if (path === '/shared/cards.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(`window.Cards={COLUMNS:${JSON.stringify(columns)},TITLE_MAX:80};`);
        return;
      }
      const relative = path === '/' ? 'index.html' : path.slice(1);
      if (!['index.html', 'app.mjs', 'api.mjs', 'board-model.mjs', 'styles.css'].includes(relative)) { res.writeHead(404); res.end(); return; }
      const mime = { '.html': 'text/html', '.mjs': 'application/javascript', '.css': 'text/css' }[extname(relative)];
      res.writeHead(200, { 'Content-Type': mime });
      res.end(await readFile(new URL(`../${relative}`, import.meta.url)));
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests, create,
    cards: () => structuredClone(cards),
    disconnect: () => { for (const client of clients) client.end(); clients.clear(); },
    async close() { for (const client of clients) client.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
