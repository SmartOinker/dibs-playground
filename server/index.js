'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { createApp } = require('./app');

async function start({
  port = Number(process.env.PORT) || 3000,
  filePath = process.env.BOARD_FILE || path.join(__dirname, 'data', 'board.json'),
} = {}) {
  const storeModule = require('../store');
  const createStore = typeof storeModule === 'function' ? storeModule : storeModule.createStore;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const store = await createStore({ filePath });
  const server = createApp({ store });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return server;
}

if (require.main === module) {
  start().then(
    (server) => console.log(`Task board on http://localhost:${server.address().port}`),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}

module.exports = { start };
