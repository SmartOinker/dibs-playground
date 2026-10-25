import { ApiError } from './api.mjs';

export function createBoardState() {
  const state = { columns: ['todo', 'doing', 'done'], cards: [], limits: {}, labelColors: [], loaded: false };
  let liveVersion = 0;
  let readVersion = 0;
  return {
    state,
    receive(cards) { state.cards = cards; liveVersion++; },
    async refresh(load) {
      const live = liveVersion;
      const read = ++readVersion;
      const board = await load();
      if (read !== readVersion) return false;
      const limit = board.limits?.doing;
      if (!(Number.isInteger(limit) && limit > 0) ||
          !Array.isArray(board.labelColors) || !board.labelColors.length ||
          !board.labelColors.every(color => typeof color === 'string')) {
        throw new ApiError('The server did not provide the board label palette and work-in-progress limit.');
      }
      // SSE contains cards only. Always read metadata, even if SSE won the race.
      state.columns = board.columns;
      state.limits = board.limits;
      state.labelColors = board.labelColors;
      if (live === liveVersion) state.cards = board.cards;
      state.loaded = true;
      return true;
    },
  };
}

export function cardFields(entries, palette) {
  const { title = '', description = '', assignee = '', column, labelNames = '', labelColor } = Object.fromEntries(entries);
  if (title.trim().length > 80) throw new ApiError('Invalid card', { title: 'Title must be at most 80 characters.' }, 400);
  const names = [...new Set(labelNames.split(',').map(name => name.trim()).filter(Boolean))];
  if (names.length && !palette.includes(labelColor)) throw new ApiError('Invalid labels', { labels: 'Choose a label color from the palette.' }, 400);
  return { title: title.trim(), description, assignee, column, labels: names.map(name => ({ name, color: labelColor })) };
}
