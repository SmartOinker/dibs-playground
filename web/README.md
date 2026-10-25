# Browser board

Plain HTML, CSS and JavaScript modules. No install, dependencies, bundling or build step. Start the API server from `server/` and open `http://localhost:3000/` (or its configured port). The server must serve this directory at `/`, JavaScript modules with a JavaScript MIME type, and the teammate-owned validator at `/shared/cards.js`.

Create cards with **New card** or a column's **+** button. Open a card to edit its title, description and assignee, change its column or position, or delete it after confirmation. Drag cards above another card or into a column to reorder them. The editor's column and position selectors provide the same move operation for keyboard and touch users. Server validation messages appear inside the editor, beside the fields when supplied.

## Agreed interfaces

All four dibs proposals were accepted at revision 1: `board.api` (#2), `board.events` (#3), `board.validation` (#4), and `board.store` (#5).

- The canonical columns are `todo`, `in-progress`, `done`, displayed as **To do**, **In progress**, **Done**. This agreement supersedes the original four-column assumption.
- `GET /api/cards` returns a flat card array. `POST /api/cards` creates a card. `PATCH /api/cards/:id` edits fields and/or moves with `{column, position}`; positions are zero based. `DELETE /api/cards/:id` returns 204.
- `GET /api/events` uses EventSource/SSE with `card.created`, `card.updated`, `card.moved`, and `card.deleted`. Each event and each stream open/reconnect refetches the board, including all reindexed siblings. Concurrent refreshes are serialized and coalesced. Unsaved editor text survives live refreshes.
- Errors use `{error: string, fields?: {title?, description?, assignee?, column?, position?}}`. The browser preserves the server's messages and retains form values after failures. It uses `window.Cards.COLUMNS` and `TITLE_MAX` from `/shared/cards.js`; Claude owns that file. The browser never imports the store.

The browser always uses same-origin URLs. Native EventSource reconnects after connection loss. The last loaded board remains visible during an outage; the inline retry button can refresh it manually.

## Tests

Requires Node 22 or newer:

```sh
node --test web/tests/*.test.mjs
```

Seven unit tests check requests, validation errors, failures, insertion indices, SSE/reconnection and refresh races. A browser test launches an installed Chromium browser with a temporary profile and runs the actual UI against an isolated HTTP/SSE contract fixture. It checks CRUD, inline errors, safe text rendering, within-column reordering, cross-column native dragging, keyboard moves, two-tab synchronization, preservation of unsaved text, reconnect recovery, mobile overflow and uncaught exceptions.

The test detects standard Chrome/Edge/Chromium paths, or set `BROWSER_BIN` to its executable. If no browser is installed, only the browser test is skipped. Optionally set `BOARD_SCREENSHOT` to a PNG path for a desktop screenshot. The fixture does not test the teammates' server/storage implementations; run the assembled app to verify that integration after merging the three parts.
