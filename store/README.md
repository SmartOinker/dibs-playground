# Board store

Node built-ins only. `store/index.js` exports `createStore` (named and default).
It imports the teammate-owned CommonJS `shared/cards.js`; that file must be
delivered before using the public entry point. No fallback validator is provided.

```js
import { createStore } from './store/index.js';

const store = createStore({ filePath: './data/board.json' });
store.on('change', ({ type, card }) => console.log(type, card.id));
const card = await store.create({ title: 'First task', column: 'todo' });
await store.update(card.id, { description: 'Details', assignee: 'Team' });
await store.move(card.id, 'doing', 0);
```

The factory returns a store immediately. Every data method returns a Promise
and waits for initialization; call `await store.list()` to check loading errors.
Awaiting the factory itself is also safe.

- `list()` returns detached cards ordered by `todo`, `doing`, `done`, then position.
- `get(id)`, `update(id, patch)`, and `move(id, column, position)` return `null`
  for unknown ids. `remove(id)` returns `true` when deleted, otherwise `false`.
- `create(input)` uses an optional supplied id or shared `newId()`. It inserts at
  the supplied final zero-based position, or appends. Positions beyond the end
  append; all positions stay contiguous. `update` cannot change column/position.
- Cards persist description and assignee (default `''`) unchanged and labels
  (default `[]`). **The agreed dibs contract uses `{ name, color }[]` labels,
  not lower-case string arrays.** Validation, including allowed colors and the
  80-character trimmed title maximum, is delegated to `shared/cards.js`.
- `listLabels()` returns sorted, unique label names from current cards. Per the
  aligned store contract, this is a derived registry, not label history.
- The store alone atomically enforces the immutable `store.limits = { doing: 5 }`.
  A sixth create or incoming move rejects with `code: 'VALIDATION_ERROR'`,
  message `"WIP limit reached for column 'doing'"`, and
  `errors: { column: 'doing column is full' }`. Reorders and metadata updates
  remain allowed at capacity. The server maps errors; it must not check WIP.
- `on('change', listener)` / `off('change', listener)` use events
  `{ type: 'card.created' | 'card.updated' | 'card.moved' | 'card.deleted', card }`.
  Events follow durable writes. Failed operations, missing ids, and no-ops emit
  nothing.

The file remains a JSON card array. Old cards gain missing optional defaults on
load. Invalid JSON, duplicate ids, invalid positions, and over-capacity saved
boards fail without rewriting the existing file. Writes use a synced temporary
file and atomic rename; failed writes leave memory unchanged.

Use one store instance per file in one process. Its queue serializes writes and
rule checks; it is not a cross-process lock. I/O errors propagate unchanged.

Run from the repository root:

```sh
node --test store/*.test.mjs
```

Existing atomic-write/core tests are extended with capacity, labels, migration,
and insertion cases. Adapter tests use explicit validation doubles. The public
integration test uses the real shared validator and skips with an explanation
if the teammate-owned module is absent.
