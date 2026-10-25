# Board store

Node built-ins only, CommonJS, no install or root package.json needed.
`shared/cards.js` is owned by Claude and must be present when running the store.
The store imports its `COLUMNS` and `validateCard`; the API uses its `newId()`.

```js
const createStore = require('./store');
const { newId } = require('./shared/cards');

const store = await createStore({ filePath: './data/board.json' });
store.on('change', ({ type, card }) => console.log(type, card.id));

const card = await store.createCard({
  id: newId(), title: 'Ship it', description: '', assignee: '',
  column: 'todo', position: 0,
});
await store.updateCard(card.id, { assignee: 'Ada' });
await store.moveCard(card.id, { column: 'in-progress', position: 0 });
const board = await store.getBoard(); // { cards: [...] }
await store.deleteCard(card.id); // returns the removed card
```

The example goes inside an async function. The factory and all five data methods
return Promises. Event subscriptions use normal synchronous EventEmitter methods.
Listeners must not throw.

Cards contain `id`, `title`, `description`, `assignee`, `column`, and `position`.
Columns are `todo`, `in-progress`, `done`. Positions are zero-based and contiguous
inside each column. Create inserts at the supplied index; the server normally
supplies the end index and a generated ID. Move indices describe the final
position, after removal from the source column. Indices beyond the end append.
Negative, fractional and unsafe indices are rejected.

`updateCard` accepts only `title`, `description`, and `assignee`; use `moveCard`
for placement. Mutations validate the resulting board before saving.
Validation errors have `statusCode: 400` (and field details when available);
unknown IDs have `statusCode: 404`. Filesystem errors retain their Node error codes.
Reads and return values are detached snapshots.

Each successful mutation saves then emits one `change` event:
`{type, card}`, with type `card.created`, `card.updated`, `card.moved`, or
`card.deleted`. Even an unchanged update/move saves and emits. Deleted events
contain the removed card; sibling reindexing emits no extra events. Refetch
`getBoard()` to obtain all sibling positions. No full board is included in events.

The file format is `{ "cards": [...] }`. Opening a missing file creates an empty
board and its parent directories. Opening invalid JSON, duplicate IDs, invalid
cards, or non-contiguous positions rejects without overwriting the file.
Mutations and reads serialize per store instance. A failed save leaves committed
memory and the old file unchanged and does not block later operations.

Writes use a unique, same-directory temporary file, flush it with `fsync`, close
it, and atomically rename it over the destination. Windows replacement locks are
retried briefly without ever deleting the old board first. A process crash before
rename can leave an ignored `.tmp` file but cannot expose a partial JSON document.
This assumes a local filesystem supporting atomic replacement; it does not
promise directory-entry durability across power loss. Use **one active store
instance/process per file**; there is no cross-process lock or live external-file
reload.

Run the tests from the repository root, after integrating Claude's shared module:

```sh
node --test store/*.test.js
```
