// Entry point: node server/index.js
// PORT defaults to 3000; BOARD_FILE sets the JSON file the store persists to.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../store/index.js';
import { createApp } from './app.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const file = process.env.BOARD_FILE ?? path.join(HERE, 'data', 'board.json');

const store = await createStore({ file });
const { server } = createApp({ store });

server.listen(port, () => {
  console.log(`Task board listening on http://localhost:${server.address().port} (data: ${file})`);
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
    server.closeAllConnections();
  });
}
