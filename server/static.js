'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// Serves files under each root, mounted at a URL prefix. Returns false when
// nothing matched so the caller can send its own 404.
function createStatic(mounts) {
  const resolved = mounts.map(({ prefix, dir }) => ({ prefix, dir: path.resolve(dir) }));

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    for (const { prefix, dir } of resolved) {
      if (!pathname.startsWith(prefix)) continue;
      let rel;
      try {
        rel = decodeURIComponent(pathname.slice(prefix.length));
      } catch {
        return false;
      }
      if (rel.includes('\0')) return false;
      let file = path.join(dir, rel);
      if (file !== dir && !file.startsWith(dir + path.sep)) return false;
      let stat = await fs.promises.stat(file).catch(() => null);
      if (stat && stat.isDirectory()) {
        file = path.join(file, 'index.html');
        stat = await fs.promises.stat(file).catch(() => null);
      }
      if (!stat || !stat.isFile()) continue;
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        fs.createReadStream(file).pipe(res);
      }
      return true;
    }
    return false;
  };
}

module.exports = { createStatic };
