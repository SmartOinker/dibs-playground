// Server-Sent Events hub: one event per card change, broadcast to every client.

const KEEPALIVE_MS = 25_000;

export function createEventHub({ keepaliveMs = KEEPALIVE_MS } = {}) {
  const clients = new Set();

  const timer = setInterval(() => {
    for (const res of clients) res.write(':\n\n');
  }, keepaliveMs);
  timer.unref();

  function subscribe(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    clients.add(res);
    const drop = () => clients.delete(res);
    req.on('close', drop);
    res.on('close', drop);
  }

  function publish(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  function close() {
    clearInterval(timer);
    for (const res of clients) res.end();
    clients.clear();
  }

  return { subscribe, publish, close, get size() { return clients.size; } };
}
