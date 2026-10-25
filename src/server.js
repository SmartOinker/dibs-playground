// Frozen. The HTTP server: serves public/ and hands API routes to the auth and events modules.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as auth from "./auth/index.js";
import * as events from "./events/index.js";
import { send } from "./http.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

// [method, path pattern, handler]. Handlers get (req, res, ...pathParams).
const routes = [
  ["POST", /^\/api\/login$/, auth.login],
  ["POST", /^\/api\/logout$/, auth.logout],
  ["GET", /^\/api\/me$/, auth.me],
  ["GET", /^\/api\/events$/, events.list],
  ["POST", /^\/api\/events\/([^/]+)\/register$/, events.register],
];

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    for (const [method, pattern, handler] of routes) {
      const match = req.method === method && pattern.exec(url.pathname);
      if (match) return await handler(req, res, ...match.slice(1));
    }
    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
    const file = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
    if (!file.startsWith(publicDir)) return send(res, 404, { error: "not found" });
    const body = await fs.readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "text/plain" });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") return send(res, 404, { error: "not found" });
    send(res, error.status ?? 500, { error: error.message });
  }
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Event sign-up on http://localhost:${port}`));
}
