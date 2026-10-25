// Codex owns this file: the page's behaviour. index.html is frozen.
//
// TODO
// - #login-form submit: POST /api/login with { email, password }, then show #session and #me.
// - On load: GET /api/me to show who is signed in, and GET /api/events to fill #events, with a
//   Register button per event that calls POST /api/events/:eventId/register.
// - #logout: POST /api/logout. Show errors in #message.
// How the page proves who is signed in on later requests, and what register returns, are shared
// interfaces: agree them through dibs.
const $ = (id) => document.getElementById(id);

$("message").textContent = "Not implemented yet.";
