# server/

The board's JSON API on port 3000. It also streams live updates over Server-Sent Events and serves the browser board in `web/`. It uses only Node built-ins (Node 22 or newer).

```sh
node server/index.js            # http://localhost:3000
PORT=4000 BOARD_FILE=/tmp/board.json node server/index.js
node --test "server/test/*.test.js"
```

Data is saved through the store module (`store/index.js`) to `server/data/board.json` by default (gitignored). Set `BOARD_FILE` to use a different file.

## API

Columns are `todo`, `doing` and `done`, in that order. A card looks like this:

```json
{ "id": "uuid", "title": "string", "description": "string", "assignee": "string", "column": "todo", "position": 0 }
```

`position` is 0-based and contiguous within each column.

| Method   | Path             | Body                                                         | Success                                              |
| -------- | ---------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `GET`    | `/api/cards`     |                                                              | `200` all cards, sorted by column, then position     |
| `GET`    | `/api/cards/:id` |                                                              | `200` card                                           |
| `POST`   | `/api/cards`     | `{ title, description?, assignee?, column? = "todo" }`       | `201` card, added at the end of its column           |
| `PATCH`  | `/api/cards/:id` | any of `{ title, description, assignee }`                    | `200` card                                           |
| `PATCH`  | `/api/cards/:id` | `{ column, position }`, which moves the card                 | `200` card; both columns are renumbered              |
| `DELETE` | `/api/cards/:id` |                                                              | `204`, no body                                       |

- A single `PATCH` can edit fields and move the card. The whole body is validated before anything is written.
- A move with `column` but no `position` puts the card at the end of that column. A `position` past the end is clamped.
- Errors are always `{ "error": string }`: `400` for invalid input or JSON, `404` for an unknown card or route, `405` for a wrong method.
- Validation comes from `shared/cards.js`: the title is required, trimmed, and at most 80 characters, and the column must be one of the three above. Multiple validation messages are joined with `"; "`.

## Live updates

`GET /api/events` is a `text/event-stream`. It opens with a `: connected` comment and sends a `:` keepalive comment every 25 seconds. Each change produces one event:

```text
event: card.moved
data: {"id":"…","title":"…","column":"doing","position":0,…}
```

The event names are `card.created`, `card.updated`, `card.moved` and `card.deleted`. The data is the full card; for a deletion it is the card as it was before deletion. The events come from the store's `change` events, so each saved change produces exactly one event. A `PATCH` that both edits and moves a card sends `card.updated` and then `card.moved`.

```js
const events = new EventSource('/api/events');
events.addEventListener('card.moved', (e) => console.log(JSON.parse(e.data)));
```

## Static files

Files in `web/` are served at `/`, and `/` serves `web/index.html`. `shared/*.js` is served at `/shared/`, so the browser can `import { validateCard } from '/shared/cards.js'`. Requests for paths outside those directories return 404.

## Files

- `index.js`: entry point. Creates the store and starts listening.
- `app.js`: `createApp({ store, webDir? })` returns `{ server, hub, handle }`, with routing and error handling.
- `events.js`: the SSE hub.
- `static.js`: static file serving.
- `http.js`: JSON body and response helpers.
- `test/`: `node:test` suites. They use the real `store/index.js` in memory if it exists. Otherwise they use `test/fake-store.js`, which implements the agreed store contract.
