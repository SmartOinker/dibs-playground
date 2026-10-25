# server/

The task board's JSON API. It persists through `store/` (Droid), streams live updates over Server-Sent Events, and serves the browser board in `web/` (Codex). Node built-ins only.

```sh
node server/index.js                      # http://localhost:3000
PORT=4000 BOARD_FILE=/tmp/b.json node server/index.js
node --test server/test/*.test.js
```

The board is saved to `server/data/board.json` (gitignored) unless `BOARD_FILE` is set.

## API (dibs contract `board.api`)

Columns, in order: `todo`, `in-progress`, `done`.
A card is `{ id, title, description, assignee, column, position }`, where `position` is 0-based and contiguous within its column.

| Route                   | Body                                                         | Response                                   |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `GET /api/cards`        |                                                              | `200` cards, sorted by column then position |
| `GET /api/cards/:id`    |                                                              | `200` card, `404`                          |
| `POST /api/cards`       | `{ title, description?, assignee?, column? = "todo" }`       | `201` card, added at the end of its column |
| `PATCH /api/cards/:id`  | any of `{ title, description, assignee }`, plus `{ column, position }` to move | `200` card, `400`, `404`  |
| `DELETE /api/cards/:id` |                                                              | `204`, `404`                               |

Errors are `{ "error": "..." }`. A `400` also has `fields`, mapping each bad field (`title`, `description`, `assignee`, `column`, `position`) to its first error message. A move reindexes the source and target columns. Positions past the end of a column go to the end.

## Live updates (`board.events`)

`GET /api/events` is a `text/event-stream`. Each change sends one event, `card.created`, `card.updated`, `card.moved` or `card.deleted`, whose `data` is the card as JSON (for a delete, the card as it was). A `: ping` comment is sent every 25 s. After `card.moved`, or after a reconnect, refetch `GET /api/cards` to pick up the shifted sibling positions. A PATCH that both edits and moves a card sends `card.updated` and then `card.moved`.

The events come from the store's `change` events, `{ type, card }`, which it emits after each durable write.

## Static files

`web/` is served at `/`, and `shared/` at `/shared/`, so the board can load `<script src="/shared/cards.js">` and use `window.Cards.validateCard`.

## Files

- `index.js`: `start({ port, filePath })` creates the store and listens.
- `app.js`: `createApp({ store, webDir?, sharedDir? })` returns the `http.Server` (routing, error mapping, SSE fan-out).
- `board.js`: maps REST calls onto the store's `getBoard`, `createCard`, `updateCard`, `moveCard` and `deleteCard`, validating with `shared/cards.js` and serializing writes.
- `events.js`, `static.js`, `http.js`: the SSE hub, the static file server and JSON helpers.
- `test/`: tests against an in-memory fake of the store contract, plus an end-to-end test that runs once `store/index.js` is present.

`shared/cards.js` (contract `board.validation`, written here) exports `COLUMNS`, `TITLE_MAX` (80), `newId()` and `validateCard(input, { partial })`.
