// Claude owns this file: sign-in and the signed-in session.
//
// TODO
// - login(req, res):  POST /api/login with { email, password }; users are in ../data.js.
// - logout(req, res): POST /api/logout.
// - me(req, res):     GET /api/me returns the signed-in user { id, name, email }, or 401.
// - Export a helper the events routes call to get the signed-in user. Its name, signature and
//   how a request proves who is signed in are shared interfaces: agree them through dibs.
import { readJson, send } from "../http.js";
import { users } from "../data.js";

export async function login(req, res) {
  send(res, 501, { error: "not implemented" });
}

export async function logout(req, res) {
  send(res, 501, { error: "not implemented" });
}

export async function me(req, res) {
  send(res, 501, { error: "not implemented" });
}
