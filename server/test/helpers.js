'use strict';

const http = require('node:http');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function request(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined, text };
}

// Opens /api/events and collects parsed { event, data } messages.
function subscribe(base) {
  return new Promise((resolve, reject) => {
    const events = [];
    const waiters = [];
    let buffer = '';
    const req = http.get(`${base}/api/events`, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const msg = {};
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) msg.event = line.slice(7);
            else if (line.startsWith('data: ')) msg.data = JSON.parse(line.slice(6));
          }
          if (msg.event) {
            events.push(msg);
            waiters.splice(0).forEach((w) => w());
          }
        }
      });
      resolve({
        res,
        events,
        // Resolves once at least n events have arrived.
        next(n) {
          return new Promise((done, fail) => {
            const timer = setTimeout(() => fail(new Error(`timed out waiting for ${n} events, got ${events.length}`)), 2000);
            const check = () => {
              if (events.length >= n) {
                clearTimeout(timer);
                done(events.slice(0, n));
              } else {
                waiters.push(check);
              }
            };
            check();
          });
        },
        close() {
          req.destroy();
        },
      });
    });
    req.on('error', reject);
  });
}

module.exports = { listen, request, subscribe };
