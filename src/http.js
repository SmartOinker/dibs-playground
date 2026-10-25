// Frozen. Small helpers every route uses.

/** Parse a JSON request body; resolves to {} when the body is empty. */
export async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

/** Send a JSON response. */
export function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
