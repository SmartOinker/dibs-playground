// Serves files from a directory (web/) with path traversal protection.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

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

// Returns true if it handled the request, false if no file matched.
export async function serveStatic(root, pathname, req, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (rel.includes('\0')) return false;
  if (rel.endsWith('/')) rel += 'index.html';

  const base = path.resolve(root);
  const file = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (file !== base && !file.startsWith(base + path.sep)) return false;

  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (info.isDirectory()) {
    res.writeHead(301, { Location: pathname + '/' });
    res.end();
    return true;
  }

  const body = await readFile(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
