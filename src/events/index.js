// Droid owns this file: the event list and registrations.
//
// TODO
// - list(req, res):              GET /api/events returns the events in ../data.js.
// - register(req, res, eventId): POST /api/events/:eventId/register registers the signed-in user.
//   Store rows in `registrations` from ../data.js. Get the signed-in user with the helper
//   exported by ../auth/index.js; its name, and the response and errors of this route, are
//   shared interfaces: agree them through dibs.
import { send } from "../http.js";
import { events, registrations } from "../data.js";

export async function list(req, res) {
  send(res, 501, { error: "not implemented" });
}

export async function register(req, res, eventId) {
  send(res, 501, { error: "not implemented" });
}
