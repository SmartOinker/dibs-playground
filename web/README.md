# Team board browser

Plain HTML, CSS and JavaScript. No install, build step, framework, npm dependencies, or root package configuration. Start Claude's API server on port 3000 and open **http://localhost:3000/**. The server serves `web/` as its static root. Serve `.js` and `.mjs` files with a JavaScript MIME type. Opening `index.html` directly from disk will not work with the API or module imports.

## Agreed interfaces

This UI follows dibs proposals **2, 3, 4 and 5, revision 1**, accepted by all participants. Those agreements supersede the original browser assumptions:

- Three columns: `todo` (To do), `doing` (In progress), `done` (Done).
- `GET /api/cards` returns a bare card array. Each card has `id`, `title`, `description`, `assignee`, `column`, and a contiguous zero-based `position` within its column.
- `POST /api/cards` creates a card with `{title, description, assignee, column}` and appends it to that column. Returns `201` with a card.
- `PATCH /api/cards/:id` edits fields and/or moves with `{column, position}`. Returns `200` with a card. Move indices refer to destination order **after removing the moved card**.
- `DELETE /api/cards/:id` returns `204` with no body.
- `GET /api/events` uses browser `EventSource` (SSE). Each `card.created`, `card.updated`, `card.moved`, or `card.deleted` event triggers a full snapshot reload. The client also reloads when the stream opens or reconnects, the browser comes online, or the page becomes visible. Requests are serialized and bursts are coalesced, including changes received during an in-flight read.
- `400` validation and `404` responses use `{error: string}`. The UI renders that exact string as text in the editor or near the board for failed drag operations. It does not infer fields by parsing the message. The server is authoritative for validation and IDs; Claude owns `shared/cards.js`, Droid owns `store/`. This UI does not import or duplicate that module.

`api.mjs` contains the API and live transport adapter; `board.mjs` holds request and ordering helpers; `app.js` handles the DOM. All browser resources are local; there are no external fonts, scripts, or network dependencies beyond the same-origin API.

## Using the board

Use **New card** or a column's add button to create a card. The arrow button on a card opens its editor. Drag anywhere on a card's body to reorder it or place it in another column; the green line marks the insertion point. An empty column accepts drops too.

Keyboard and touch users can open the editor and select **Column** and **Position**, then save. Positions display as one-based labels for people and are sent as zero-based indices. Delete requires an explicit confirmation inside the editor. Escape closes the editor unless a save is in progress.

Draft fields survive incoming updates and validation failures. The connection indicator shows SSE state; **Retry** reloads the board and reconnects the stream. The board preserves the last successful snapshot after a refresh failure and displays the error.

## Tests

From the repository root, with Node 22 or newer:

```sh
node --test web/tests/*.test.mjs
node --check web/app.js
```

Tests use only Node built-ins. They cover exact HTTP contracts, literal validation messages, malformed responses, drag indices, snapshot refresh races, event subscription, and UI event handlers for create/edit/delete, inline errors, keyboard placement, drag reorder, live updates, reconnect and retry. The DOM fixture does not emulate browser layout or native pointer behavior. Browser automation was unavailable in the implementation session, so visual and native drag checks remain manual:

1. Create cards with title, description and assignee; edit them and confirm deletion.
2. Submit a blank or whitespace-only title; verify the server error appears in the open editor and the draft remains.
3. Drag upward/downward within a column, between nonempty columns, and into an empty column. Confirm order after reloading.
4. Open two tabs and change the board in one; confirm the other updates. Keep a draft open while doing this.
5. Stop and restart the server; verify connection feedback and automatic recovery. Try a narrow viewport and keyboard-only editing.
