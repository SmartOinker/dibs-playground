# Demo: three agents, one notes app

Three agents build one small notes app in parallel. Each prompt quietly sets up
one situation dibs is built to catch, on its own shared interface:

| Interface          | Situation      | What happens without dibs                                                                                               | What dibs does                                                                     |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `api.notes`        | **Conflict**   | Claude's API returns `{ notes, total }` with page numbers; Codex's UI expects a bare array with cursors. The UI breaks. | Finds the contradiction and proposes one shape both must build to.                 |
| `notes.validation` | **Duplicate**  | Claude and Droid both write their own note-validation module, with different rules.                                     | Spots the duplicate work and assigns one owner and one exported function.          |
| `notes.search`     | **Dependency** | Codex's search box and Claude's server both assume Droid's search module exists, but nobody agreed its route or export. | Pins down the exact route and module interface so all three can build in parallel. |

Each prompt says **what** to build and nudges its default assumptions, but not
the exact interface. Disagreeing is the point.

## Setup

Everyone: install the latest dibs, start from a fresh `main`, and make a branch.

```sh
gh release download real-exp-latest --repo 2elliot/dibs --pattern '*.tgz' --clobber
npm install --global ./dibs-experience-0.1.0.tgz
git clone https://github.com/SmartOinker/dibs-playground.git demo && cd demo
git switch -c demo/<claude|codex|droid>
```

**Claude laptop** creates the room (one line):

```sh
dibs create --provider claude --brief "A small notes app with tags and search, built with Node built-ins only (no npm dependencies). server/ is the JSON API on port 3000; web/ is the browser UI it serves; search/ is a search module that the API mounts." --interface api.notes="Notes REST API: routes, pagination, request and response JSON" --interface notes.validation="The single module and rules that validate a note (title, body, tags)" --interface notes.search="Search: the search module's exported functions and the HTTP search route"
```

Share the `dibs1_…` code. Open the printed **Story view** link on the big screen.

**Codex laptop:** `dibs join <code> --provider codex`  
**Droid laptop:** `dibs join <code> --provider droid`

Everyone opens their agent in the folder (`claude`, `codex`, `droid`), accepts the
trust prompts, and checks `dibs doctor --provider <yours>`.

Paste the prompts below **at about the same time**.

## Prompt 1 — Claude (`server/`)

```text
You're building the backend of our notes app in server/. Two teammates are building other parts at the same time, each with their own coding agent, coordinated through dibs.

Build a JSON API on port 3000 with Node's built-in http module (no npm dependencies):
- CRUD for notes: a note has a title, a markdown body, and tags.
- Listing notes must be paginated. My preference: page/pageSize query params, and the list response is an object { notes, total, page, pageSize }.
- Validate notes on create and update (title required and at most 120 characters; tags lowercase, at most 5). I'd like that validation in its own reusable module.
- The API should expose search by mounting the search module my teammate is writing in search/.
- Also serve the static files in web/ at /.

Before writing any shared code, call dibs_status and publish your plan with dibs_plan: say what you produce and what you require for api.notes, notes.validation and notes.search. Then build what doesn't depend on others. When a proposal arrives, read it and accept or reject the exact revision with dibs_respond, and follow the agreed contract exactly. Add a short server/README.md and tests using node:test.
```

## Prompt 2 — Codex (`web/`)

```text
You're building the browser UI of our notes app in web/. Two teammates are building other parts at the same time, each with their own coding agent, coordinated through dibs.

Build a plain HTML/CSS/JS single page (no frameworks, no build step) that the API server serves at /:
- A list of notes with infinite scroll. I'm assuming the API returns a plain JSON array and uses cursor pagination (a "cursor" query param, with the next cursor in a response header).
- Create, edit and delete notes. A note has a title, a markdown body and tags; render the body as simple markdown.
- Filter by tag, and a search box that calls the search route.
- Show a validation error inline when the server rejects a note.

Before writing code that talks to the API, call dibs_status and publish your plan with dibs_plan: say what you require on api.notes and notes.search. Work on the layout and styling while you wait. When a proposal arrives, accept or reject the exact revision with dibs_respond, and then code strictly against the agreed contract, even where it differs from my assumptions above.
```

## Prompt 3 — Droid (`search/`)

```text
You're building the search part of our notes app in search/. Two teammates are building the API (server/) and the UI (web/) at the same time, each with their own coding agent, coordinated through dibs.

Build a dependency-free Node module in search/:
- An in-memory full-text index over note titles, bodies and tags, with ranking (title matches above body matches) and tag filters.
- An HTTP handler for the search route that the API server will mount, so the UI can call it.
- Notes must be validated before they're indexed, so write a note-validation module for that (title required, tags lowercase).
- Unit tests with node:test.

Before writing shared code, call dibs_status and publish your plan with dibs_plan: say what you produce on notes.search and notes.validation, and what you require. Build the indexing internals while you wait. When a proposal arrives, accept or reject the exact revision with dibs_respond, then follow the agreed contract exactly, including if it says another teammate owns a module you planned to write.
```

## What to watch for

- **Plans** appear as nodes and edges in the story view (solid = builds, dashed = needs).
- **About 15–60 seconds after the plans**, the worker creates up to three proposals:
  - `api.notes` as a **contradiction** (red): one pagination and response shape.
  - `notes.validation` as **redundancy** (orange): one owner, one exported function.
  - `notes.search` as **depends on** (blue): the exact route and module exports.
- Each agent votes. Once every involved agent accepts, the node turns **green (agreed)**.
- Afterwards, check the code: only one validation module, the UI's fetch calls match
  the agreed list shape, and the server mounts search exactly as agreed.

## Run it together

Each person commits their folder on their `demo/…` branch and pushes. Merge the
three branches into one checkout, then:

```sh
node server/index.js   # or whatever entry point the agreed contract names
```

Open http://localhost:3000, then add, tag, search and page through notes.

## Reset between takes

```sh
dibs leave --provider <codex|droid>        # joiners
dibs close --provider claude               # creator
```

If the experiment server was redeployed mid-take, use `dibs leave --local --provider <yours>`.
