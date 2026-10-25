# Browser task board

Plain HTML, CSS, and ES modules. No install or build step. Start the teammate's
server on port 3000 and open http://localhost:3000/; it serves this folder.

Create tasks with a title, optional description and assignee, and a destination
column. Drag tasks between or within columns. Each task also has a column menu
and up/down buttons for keyboard and touch use, plus Delete. Server validation
appears beside the relevant form field or affected task. User text is rendered
with `textContent`.

Add labels as comma-separated names and choose their color from the server's
palette. Cards show colored label chips; use **Filter by label** to show cards
with an exact label name. Cards without labels remain visible with All labels.
The creation form applies the chosen color to every entered label.

Doing shows its total occupancy and API-provided WIP limit, with **Full** when
capacity is reached. Incoming drops, move choices, and creation in Doing are
disabled at capacity. Reordering inside Doing and moving out remain available.
Filtering never reduces the occupancy used for capacity checks. Reordering a
filtered list uses positions in the full board.

The dibs agreement takes precedence over the initial assumptions:
API proposal 10 revision 3, labels proposal 12 revision 1, revised limits
proposal 14 revision 4, board.store aligned contract revision 1, and the existing
SSE transport (proposal 9 revision 2). The newer labels agreement extends SSE
cards with the seventh `labels` field. The revised limits agreement supersedes
the API contract's earlier configurable/unlimited limit and server enforcement.

- Columns: `todo`, `doing`, `done` (To do, Doing, Done).
- `GET /api/board` returns `{ columns, cards, limits: { doing: number },
  labelColors: string[] }`. The store owns the fixed, read-only cap of five;
  the API derives `limits.doing` from `store.limits.doing`. Palette and limit
  metadata are loaded at startup and refreshed after SSE events; neither is
  hard-coded in the browser. Missing settings or an invalid (including null)
  limit leave mutations disabled until a successful board read.
- `POST /api/cards` accepts `{ title, description, assignee, column, labels }`.
- `PATCH /api/cards/:id` moves with `{ column, position }`; positions are zero
  based in the destination column after removal of the source card.
- `DELETE /api/cards/:id` returns 204.
- Errors: `{ error, errors?: { [field]: message } }`.
- Full-column rejection is HTTP 400 with `{ error: "WIP limit reached for column
  'doing'", errors: { column: "doing column is full" } }`. Only the store enforces
  capacity, atomically inside its serial queue; the server maps its
  `VALIDATION_ERROR` to this response. The browser handles this error when
  another user fills the column during a request.
- `EventSource('/api/events')` receives full card arrays in `snapshot` and
  `cards` events. Reconnect snapshots replace local state. A late HTTP read
  cannot overwrite a newer live snapshot.

Cards contain `id`, `title`, `description`, `assignee`, `column`, `position`, and
`labels: { name, color }[]` (default `[]`). The palette is fixed by the server;
label names are trimmed, at most 30 characters, with at most 10 labels per card
and duplicates deduped by name. The server reports invalid labels inline.
Titles are limited to 80 trimmed characters in the browser and server.
The browser does not import or duplicate the store or shared validation module.
`store/index.js` persists all seven card fields, including description and
assignee, with defaults for older cards. Its async methods and post-persistence
change events feed the API and SSE; the browser uses only those HTTP interfaces.
The store's `listLabels()` derives names from current cards, so the browser
likewise builds label choices from the current full snapshot.

Run the dependency-free tests with Node 22+:

```sh
node --test web/*.test.mjs
```

Tests cover the HTTP contract against a local HTTP fixture, server errors,
live snapshot/reconnect handling, label payloads/filtering, full-column drag and
menu blocking, same-column reorder, filtered drop indices, and metadata/card
races. The DOM fixture exercises actual rendering and event handlers without
third-party dependencies.
To check the full integration, open two tabs, create a task, move it, and delete
it; both boards should update. Submit a title longer than 80 characters to
check the server's inline validation.
