'use strict';

// Fans change events out to every connected Server-Sent Events client.
function createEventHub({ heartbeatMs = 25000 } = {}) {
  const clients = new Set();

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, heartbeatMs);
  heartbeat.unref();

  function connect(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const drop = () => clients.delete(res);
    req.on('close', drop);
    res.on('close', drop);
  }

  function send(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  function close() {
    clearInterval(heartbeat);
    for (const res of clients) res.end();
    clients.clear();
  }

  return { connect, send, close, get size() { return clients.size; } };
}

module.exports = { createEventHub };
