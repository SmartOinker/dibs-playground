# dibs demo: three agents, one live task board

Claude Code, Codex and Droid each build one layer of a live team task board (a
small Kanban app) at the same time, on three laptops. Each layer is built on top
of another agent's layer **that doesn't exist yet**:

```text
web/     Codex   browser board      → needs the API and its live updates
server/  Claude  JSON API + events  → needs the store module
store/   Droid   persistence        → (bottom layer)
shared/          card validation + ids, which two agents both plan to write
```

You run the **same prompts twice**: once without dibs, once with it. Then
compare how the branches merge and how much fixing it takes to get a working app.

## What the prompts set up

Every prompt states its agent's own assumptions. Nobody is told the others'.

| Interface          | Planted problem                                                                                                                                                              | Without dibs                                                     | With dibs                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `board.api`        | **Conflict.** Claude: columns `todo/doing/done`, move with `PATCH {column, position}`. Codex: columns `backlog/in_progress/review/done`, move with `POST /move {to, index}`. | The board can't load or move cards.                              | One proposal fixes the column ids and move route; both agents build to it.            |
| `board.events`     | **Conflict.** Claude: Server-Sent Events at `/api/events`, one event per change. Codex: a WebSocket at `/ws` pushing the whole board.                                        | No live updates.                                                 | One agreed stream, route and payload.                                                 |
| `board.store`      | **Dependency.** Claude builds the API on Droid's store before it exists. Droid also picks its own column ids (`in-progress`) and makes everything async.                     | The server calls functions the store doesn't have.               | The store's exports and signatures are pinned, so Claude and Droid build in parallel. |
| `board.validation` | **Duplicate.** Claude and Droid are **both** told to write card validation and ids in `shared/cards.js`.                                                                     | Two different versions of one file: a guaranteed merge conflict. | One owner writes it; the other imports it.                                            |

## Setup (once)

Each laptop needs Node 22 or newer, a signed-in `gh` with read access to
`2elliot/dibs`, and its coding agent installed and signed in.

```sh
gh release download real-exp-latest --repo 2elliot/dibs --pattern '*.tgz' --clobber
npm install --global ./dibs-experience-0.1.0.tgz
```

To update dibs later, run the same two commands. To remove it:
`npm uninstall --global @dibs/experience`.

## Run 1: without dibs

Each laptop, in a **fresh clone** (don't run `dibs create` or `join` here):

```sh
git clone https://github.com/SmartOinker/dibs-playground.git nodibs && cd nodibs
git switch -c nodibs/<claude|codex|droid>
```

Open the agent and paste its prompt from [The prompts](#the-prompts) **without**
the dibs paragraph. When it's done:

```sh
git add -A && git commit -m "<agent>: no-dibs run" && git push -u origin HEAD
```

## Run 2: with dibs

Each laptop, in another **fresh clone**:

```sh
git clone https://github.com/SmartOinker/dibs-playground.git withdibs && cd withdibs
git switch -c dibs/<claude|codex|droid>
```

**Claude laptop** creates the room (one line):

```sh
dibs create --provider claude --brief "A live team task board (Kanban), Node built-ins only, no npm dependencies. store/ is the persistence module; server/ is the JSON API on port 3000, built on the store, which also serves web/ and streams live updates; web/ is the browser board; shared/ holds code more than one part uses." --interface board.api="Board REST API: column ids, card JSON, routes, and how a card is moved" --interface board.events="Live updates: the stream route, transport, event names and payloads" --interface board.store="The store module the API builds on: file, exported functions, signatures, change events" --interface board.validation="The one shared module that validates cards and generates ids, and who writes it"
```

Share the `dibs1_…` code and put the printed **Dashboard** link (the live graph)
on the big screen.

- **Codex laptop:** `dibs join <code> --provider codex`
- **Droid laptop:** `dibs join <code> --provider droid`

Everyone opens their agent in the folder, accepts its trust prompts, and checks
`dibs doctor --provider <yours>`. Then paste the prompts **with** the dibs
paragraph, at about the same time. Push the same way, on the `dibs/<agent>`
branches.

## Compare the runs

**1. Merge report.** From any clone:

```sh
node scripts/merge-report.mjs nodibs
node scripts/merge-report.mjs dibs
```

It merges each run's three branches onto `main` in a throwaway worktree and prints
the merge conflicts, the files more than one agent wrote, and the files each
agent wrote outside its folder.

**2. GitHub's view.** For each run, open three pull requests into that run's
integration branch (`run/nodibs` or `run/dibs`). Merge the first one; GitHub
then shows **"This branch has conflicts that must be resolved"** on any that
clash:

```sh
gh pr create --base run/nodibs --head nodibs/claude --title "No dibs: Claude"
```

**3. Does it run, and what does fixing it cost?** Check out each integration
branch with all three merged, start the server, and try the board at
http://localhost:3000 (create, drag between columns, open it in two tabs to see
live updates). For the no-dibs run, ask one agent to "resolve the conflicts and
make the board work end to end", then measure the fix:

```sh
git diff --stat <before-fix>..HEAD
```

## The prompts

### Claude: `server/`

```text
You're building the API of our team task board in server/. Two teammates are building the other parts at the same time with their own coding agents: Droid is writing the storage module in store/, and Codex is writing the browser board in web/. Use Node built-ins only, no npm dependencies, and don't add a root package.json.

Build an HTTP server on port 3000 that:
- Uses my teammate's store module in store/ for all persistence. Don't write your own storage; assume it gives you a store object with methods for cards.
- Exposes a REST API for cards. Columns are "todo", "doing" and "done". A card has id, title, description, assignee, column and an integer position within its column. Moving a card is PATCH /api/cards/:id with { column, position }.
- Streams live updates over Server-Sent Events at /api/events: one event per change, named "card.created", "card.updated", "card.moved" or "card.deleted", with the card as data.
- Validates cards (title required, at most 80 characters) and generates ids. Put that in shared/cards.js so the UI can reuse it.
- Serves the static files in web/ at /.
Write tests with node:test, and a short server/README.md.
```

### Codex: `web/`

```text
You're building the browser board of our team task board in web/. Two teammates are building the other parts at the same time with their own coding agents: Claude is writing the API server in server/ (port 3000, and it serves this folder at /), and Droid is writing the storage module in store/. Plain HTML, CSS and JS: no frameworks, no build step, no npm dependencies.

Build a board that:
- Shows four columns: Backlog, In progress, Review and Done. I'm assuming the API's column ids are "backlog", "in_progress", "review" and "done".
- Lets you create, edit and delete cards (title, description, assignee) and drag cards between and within columns. I'm assuming a move is POST /api/cards/:id/move with { to, index }.
- Updates live when a teammate changes the board. I'm assuming a WebSocket at /ws that pushes the whole board as JSON after every change.
- Shows the server's validation errors inline.
```

### Droid: `store/`

```text
You're building the storage layer of our team task board in store/. Two teammates are building on top of it at the same time with their own coding agents: Claude is writing the API server in server/, which will use your module for all persistence, and Codex is writing the browser board in web/. Node built-ins only, no npm dependencies, and don't add a root package.json.

Build a store module that:
- Persists the board to a JSON file with atomic writes, so a crash can't corrupt it, and loads it on start.
- Keeps cards in the columns "todo", "in-progress" and "done", with an order inside each column, and supports create, update, move (with reordering) and delete.
- Is async (every function returns a Promise) and emits a change event whenever the board changes, so the server can push live updates.
- Validates cards before saving and generates ids. Put that in shared/cards.js so the other parts can reuse it.
Write tests with node:test, and a short store/README.md.
```

### The dibs paragraph (run 2 only)

Add this to the end of each prompt:

```text
Coordinate through dibs before writing shared code: call dibs_status, then publish your plan with dibs_plan, saying what you produce and what you require on board.api, board.events, board.store and board.validation. Build the parts that don't depend on anyone while you wait. When a proposal arrives, read it and accept or reject the exact revision with dibs_respond, then follow the agreed contract exactly, even where it differs from what I said above, including when it gives a module you planned to write to a teammate.
```

## What to watch in run 2

- Plans land as nodes and edges in the graph (solid = builds, dashed = needs).
- Within about a minute the worker raises up to four proposals: red for the
  conflicts, orange for the duplicate, blue for the dependency. Each needs every
  involved agent's vote; agreed interfaces turn green.
- Claude starts the server against the agreed store interface while Droid is
  still writing the store. That's the parallel work.

## Reset between takes

```sh
dibs leave --provider <codex|droid>   # joiners
dibs close --provider claude          # creator
```

If the experiment server was redeployed mid-take, use
`dibs leave --local --provider <yours>`. To redo a run, delete its branches
(`git push origin --delete nodibs/claude …`) and start from fresh clones.

## Notes

- **Don't push to `real_exp` in the dibs repo while recording.** Every push
  redeploys the experiment server and wipes all rooms.
- **Don't commit dibs' config files.** `dibs create`/`join` writes `.mcp.json`,
  `.claude/settings.local.json`, `.codex/` and `.factory/` with paths for your
  machine; `.gitignore` already excludes them.
- **Plans and messages are publicly readable** in the experiment database, so keep
  briefs and plans free of anything private.
