# Board store

Node 22+ and built-ins only. `store/package.json` scopes ESM to this folder;
there is no root manifest. The agreed columns are `todo`, `doing`, `done`.
Claude owns the required ESM `shared/cards.js` (`COLUMNS`, `newId`,
`validateCard`), including title validation and ID generation.

```js
import { createStore } from './store/index.js';
import { newId } from './shared/cards.js';

const store = await createStore({ file: './data/board.json' });
store.on('change', ({ type, card }) => {
  // Forward type and card to the server's live-update stream.
});
const created = await store.createCard({
  id: newId(), title: 'Ship the board', description: '', assignee: '',
  column: 'todo', position: 0,
});
await store.moveCard(created.id, 'doing', 0);
await store.close();
```

`createStore()` without `file` creates an isolated in-memory board. A missing
file starts empty; malformed JSON or invalid stored cards reject startup without
overwriting the file.

All data methods return Promises:

| Method | Result |
| --- | --- |
| `listCards()` | Cloned cards, sorted by column order and position |
| `getCard(id)` | Cloned card or `null` |
| `createCard(card)` | Validated full card appended to its column |
| `updateCard(id, {title?, description?, assignee?})` | Updated card or `null` |
| `moveCard(id, column, position)` | Moved card or `null` |
| `deleteCard(id)` | Deleted card, as it was, or `null` |
| `close()` | Waits for pending operations; no handles remain open |

Callers generate IDs with `newId()` and supply all card fields on creation.
The store calculates the actual append position inside its mutation queue, so
concurrent callers cannot create duplicate positions. IDs must be unique UUIDs.
Updates preserve omitted fields. Moves use a destination index **after removing
the card**, clamp integer indices into range, and renumber both columns.
Deletes also renumber. Positions are always contiguous and zero-based.
Invalid input rejects with `error.code === 'VALIDATION_ERROR'`; I/O errors retain
their original codes. Missing IDs return `null`.

The store is an `EventEmitter`; standard `.on()`/`.off()` subscriptions are
synchronous. After saving each actual change, it emits `change` with
`{ type, card }`, where type is `card.created`, `card.updated`, `card.moved`,
or `card.deleted`. Payloads and returned cards do not expose internal state.
Unchanged operations, missing IDs and failed saves emit nothing. Event listeners
should not throw. `close()` is a drain barrier, not a permanent shutdown.

Disk format is `{ "cards": [/* full cards */] }`. Each save writes a unique
temporary file in the same directory, flushes and closes it, then renames it over
the board. Failed writes leave the prior disk and memory snapshots unchanged.
A process crash cannot leave a partially written board; it may leave an unused
temporary file. Whole-machine power-loss durability depends on the filesystem
(directory metadata is not fsynced). Use one store instance per file; there is
no cross-process locking.

Run the tests after Claude's shared module is available:

```sh
node --test store/*.test.js
```
