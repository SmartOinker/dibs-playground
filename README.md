# dibs live demo: three agents, one sign-in, the judges decide

A tiny event sign-up app. Three coding agents each fill in one file, on three
laptops, coordinated by [dibs](https://github.com/2elliot/dibs). Their prompts
give them opposite, well-argued requirements for how sign-in works, so they
reject the AI's proposals twice. The interface **freezes**, the **judges choose**,
and the agents finish the app the judges' way.

```text
src/server.js, src/http.js, src/data.js, public/index.html   done and frozen
src/auth/index.js     Claude   sign-in, GET /api/me, helper for "who is signed in"
public/app.js         Codex    the page: sign in, list events, Register buttons
src/events/index.js   Droid    the event list and registrations
```

| Interface             | Claude                     | Codex                          | Droid                             | Expected                                       |
| --------------------- | -------------------------- | ------------------------------ | --------------------------------- | ---------------------------------------------- |
| `auth.session`        | httpOnly cookie (security) | JWT bearer header (mobile API) | n/a                               | rejected twice, then **frozen: judges decide** |
| `auth.server`         | `currentUser(req)`         | n/a                            | assumes `requireUser(req)`        | dependency, then agreed                        |
| `events.registration` | n/a                        | wants `{ id, eventId }`        | wants `{ registrationId, email }` | conflict, then agreed                          |

## Setup (once per laptop)

Node 22+, a signed-in `gh` with read access to `2elliot/dibs`, and the agent CLI.

```sh
gh release download real-exp-latest --repo 2elliot/dibs --pattern '*.tgz' --clobber
npm install --global ./dibs-experience-0.1.0.tgz
git clone https://github.com/SmartOinker/dibs-playground.git demo && cd demo
git switch -c live/<claude|codex|droid>
```

## Run sheet

**T-3:00 (Claude laptop) create the room:**

```sh
dibs create --provider claude --brief "Event sign-up: people sign in, see upcoming events and register. Node built-ins only, no dependencies. Claude owns src/auth/, Codex owns public/app.js, Droid owns src/events/. src/server.js, src/http.js, src/data.js and public/index.html are done and frozen." --interface auth.session="How the browser proves who is signed in: what POST /api/login returns and what every later request sends" --interface auth.server="The helper exported by src/auth/index.js that other routes call to get the signed-in user" --interface events.registration="POST /api/events/:eventId/register: what it returns, its errors, and how registrations are keyed"
```

Put the printed **Dashboard** link on the big screen. Others join:
`dibs join <code> --provider codex` and `dibs join <code> --provider droid`.

**T-2:30 (each laptop)** start the agent in the folder (`claude`, `codex`, `droid`),
accept its dibs MCP and hook prompts, check `dibs doctor --provider <yours>`, then
paste its prompt below. Paste all three within a few seconds.

**T+0:00 on stage**, with the story view on screen:

1. The plans land. The AI finds the three problems.
2. `auth.server` and `events.registration` get agreed.
3. `auth.session`: one agent rejects, dibs revises, the other rejects. It turns
   **FROZEN**, and the panel shows **Option A** and **Option B** with who rejected
   each and why.
4. Read the two options to the judges, or show them in a terminal:
   `dibs decide auth.session --provider claude`. **The judges pick.**
5. Claude laptop: `dibs decide auth.session A --provider claude` (or `B`).
   The node turns green; every agent receives the decision and finishes the
   app that way, including the agent whose position lost.

**Finale:** each laptop commits and pushes its branch; merge the three and run:

```sh
git merge origin/live/claude origin/live/codex origin/live/droid
npm start
```

Open http://localhost:3000, sign in as `alice@example.com` / `alice`, and register
for an event. It works the way the judges chose.

## The prompts

### Claude: `src/auth/index.js`

```text
You own src/auth/index.js in this repo (read README.md and the stub). Teammates are working at the same time with their own coding agents: Codex writes the page in public/app.js and Droid writes src/events/index.js. Implement POST /api/login, POST /api/logout, GET /api/me, and the helper other routes use to get the signed-in user.

Session design, NON-NEGOTIABLE: /api/login sets an httpOnly, SameSite=Lax session cookie, and the browser never sees or stores a token. Reason: our security review bans tokens that JavaScript can read; one XSS bug would leak every session, and we failed an audit for exactly this last month. Reject any contract that puts a token in JavaScript storage or an Authorization header.

Helper (a preference, fine to adapt): export currentUser(req), which returns the user or null.
```

### Codex: `public/app.js`

```text
You own public/app.js in this repo (read README.md, public/index.html and the stub); index.html is frozen. Teammates are working at the same time with their own coding agents: Claude writes sign-in in src/auth/index.js and Droid writes src/events/index.js. Implement sign-in, sign-out, showing who is signed in, the event list and a Register button per event.

Session design, NON-NEGOTIABLE: POST /api/login returns { token } (a JWT), and every later request sends Authorization: Bearer <token>; keep the token in memory or sessionStorage. Reason: the same API client is used by our mobile app and partner integrations on other origins, where cookies do not work, and the web page must use the identical client. Reject any contract that relies on cookies.

Registration (a preference, fine to adapt): you expect POST /api/events/:eventId/register to return 201 { id, eventId }.
```

### Droid: `src/events/index.js`

```text
You own src/events/index.js in this repo (read README.md and the stub). Teammates are working at the same time with their own coding agents: Claude writes sign-in in src/auth/index.js and Codex writes the page in public/app.js. Implement GET /api/events and POST /api/events/:eventId/register for the signed-in user, storing rows in the registrations array in src/data.js.

Registration (a strong preference, but you can adapt): key registrations by the user's email and return 201 { registrationId, email, eventId }, 409 if already registered, 401 if nobody is signed in. Reason: billing and analytics join on email. You need the auth helper from src/auth/index.js; you are assuming requireUser(req), which throws a 401 error, but agree the real name through dibs.
```

### The dibs paragraph (add to the end of all three)

```text
Coordinate through dibs before writing shared code: call dibs_status, then publish your plan with dibs_plan on auth.session, auth.server and events.registration (mark produces only for what you build, requires for what you use from a teammate). Build what does not depend on anyone while you wait. When a proposal arrives, accept it if it is workable, but reject it with a one-line reason if it breaks a NON-NEGOTIABLE requirement. If an interface becomes frozen, stop work on it and keep calling dibs_status with waitSec 45 until the developers' decision arrives as its agreed contract; then implement exactly that, even if it is the option you rejected. Keep it small. Do not commit or push.
```

## Reset between takes

```sh
dibs leave --provider <codex|droid>   # joiners
dibs close --provider claude          # creator
git checkout -- . && git clean -fd    # throw away the agents' work in this clone
```

If the experiment server was redeployed mid-take, use `dibs leave --local --provider <yours>`.

## Notes

- **Don't push to `real_exp` in the dibs repo before or during the demo.** Every
  push redeploys the experiment server and wipes all rooms.
- **Don't commit dibs' config files.** `.gitignore` already excludes `.mcp.json`,
  `.claude/settings.local.json`, `.codex/` and `.factory/`.
- **Plans and messages are publicly readable** in the experiment database.
- `scripts/merge-report.mjs <run>` prints how a run's `<run>/<agent>` branches merge.
