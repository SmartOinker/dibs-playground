import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, fixtureCard, fakeServer } from './dom-fixture.mjs';

test('board loads accepted columns and creates a card with literal text safely', async () => {
  const server = fakeServer();
  const app = await startApp(server.fetch);
  assert.deepEqual(app.columns().map(column => column.dataset.column), ['todo', 'doing', 'done']);
  assert.equal(app.$('new-card').disabled, false);
  await app.$('new-card').emit('click');
  assert.equal(app.$('card-dialog').open, true);
  app.$('title').value = '<img src=x onerror=alert(1)>';
  app.$('description').value = 'Line one\nLine two';
  app.$('assignee').value = 'Ada Lovelace';
  app.$('column').value = 'doing';
  await app.$('card-form').emit('submit');
  assert.equal(app.$('card-dialog').open, false);
  assert.equal(app.cards().length, 1);
  assert.equal(app.cards()[0].querySelectorAll('.card-title')[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(app.cards()[0].querySelectorAll('img').length, 0);
  assert.equal(app.cards()[0].querySelectorAll('.avatar')[0].textContent, 'AL');
  assert.equal(app.$('total-count').textContent, '1');
});

test('server validation stays inline, preserves draft and permits correction', async () => {
  const server = fakeServer();
  const app = await startApp(server.fetch);
  await app.$('new-card').emit('click');
  app.$('description').value = 'Keep my draft';
  await app.$('card-form').emit('submit');
  assert.equal(app.$('card-dialog').open, true);
  assert.equal(app.$('form-error').hidden, false);
  assert.equal(app.$('form-error').textContent, 'title: A title is required.');
  assert.equal(app.$('description').value, 'Keep my draft');
  assert.equal(app.$('save-card').disabled, false);
  app.$('title').value = 'Fixed title';
  await app.$('card-form').emit('submit');
  assert.equal(app.$('card-dialog').open, false);
  assert.equal(server.cards[0].description, 'Keep my draft');
});

test('edit fields and keyboard placement are saved together using PATCH', async () => {
  const server = fakeServer([fixtureCard('a'), fixtureCard('b', 'done')]);
  const app = await startApp(server.fetch);
  await app.cards()[0].querySelectorAll('button')[0].emit('click');
  app.$('title').value = 'Updated';
  app.$('assignee').value = 'Grace Hopper';
  app.$('column').value = 'done';
  await app.$('column').emit('change');
  app.$('position').value = '0';
  await app.$('card-form').emit('submit');
  const patch = server.calls.find(call => call.method === 'PATCH');
  assert.deepEqual(patch.body, { title: 'Updated', description: '', assignee: 'Grace Hopper', column: 'done', position: 0 });
  assert.deepEqual(app.cards().map(node => node.dataset.id), ['a', 'b']);
  assert.equal(server.cards.find(card => card.id === 'a').column, 'done');
});

test('delete requires confirmation and handles a teammate already deleting the card', async () => {
  const server = fakeServer([fixtureCard('a')]);
  const app = await startApp(server.fetch);
  await app.cards()[0].querySelectorAll('button')[0].emit('click');
  await app.$('delete-card').emit('click');
  assert.equal(app.$('delete-confirmation').hidden, false);
  assert.equal(server.calls.some(call => call.method === 'DELETE'), false);
  server.cards = [];
  await app.$('confirm-delete').emit('click');
  assert.equal(app.$('form-error').textContent, 'Card not found');
  assert.equal(app.$('card-dialog').open, true);
  await app.$('cancel-dialog').emit('click');
  server.cards = [fixtureCard('a')];
  app.streams[0].emit('card.created');
  await app.settle();
  await app.cards()[0].querySelectorAll('button')[0].emit('click');
  await app.$('delete-card').emit('click');
  await app.$('confirm-delete').emit('click');
  assert.equal(app.$('card-dialog').open, false);
  assert.equal(app.cards().length, 0);
});

test('drag reorders within a column and moves into an empty column with exact indices', async () => {
  const server = fakeServer([fixtureCard('a'), fixtureCard('b', 'todo', 1), fixtureCard('c', 'todo', 2)]);
  const app = await startApp(server.fetch);
  const transfer = { setData() {} };
  await app.cards()[0].emit('dragstart', { dataTransfer: transfer });
  app.cards().forEach((node, index) => { node.testTop = index * 100; });
  await app.columns()[0].emit('dragover', { dataTransfer: transfer, clientY: 280 });
  await app.columns()[0].emit('drop');
  assert.deepEqual(server.calls.find(call => call.method === 'PATCH').body, { column: 'todo', position: 2 });
  assert.deepEqual(app.cards().map(node => node.dataset.id), ['b', 'c', 'a']);
  await app.cards()[0].emit('dragstart', { dataTransfer: transfer });
  await app.columns()[1].emit('dragover', { dataTransfer: transfer, clientY: 300 });
  await app.columns()[1].emit('drop');
  assert.deepEqual(server.calls.filter(call => call.method === 'PATCH').at(-1).body, { column: 'doing', position: 0 });
});

test('live events and reconnects reload full snapshots without overwriting editor drafts', async () => {
  const server = fakeServer([fixtureCard('a')]);
  const app = await startApp(server.fetch);
  app.streams[0].emit('open');
  await app.settle();
  assert.match(app.$('connection-text').textContent, /Live/);
  await app.cards()[0].querySelectorAll('button')[0].emit('click');
  app.$('title').value = 'My unfinished edit';
  server.cards = [fixtureCard('a', 'done'), fixtureCard('b')];
  app.streams[0].emit('card.moved');
  await app.settle();
  assert.equal(app.cards().length, 2);
  assert.equal(app.$('title').value, 'My unfinished edit');
  app.streams[0].emit('error');
  assert.match(app.$('connection-text').textContent, /Reconnecting/);
  server.cards = [];
  app.streams[0].emit('open');
  await app.settle();
  assert.equal(app.cards().length, 0);
  assert.match(app.$('connection-text').textContent, /Live/);
});

test('failed initial load exposes Retry and recovers without reloading the page', async () => {
  const server = fakeServer([fixtureCard('a')]);
  server.failNext(503, 'Temporarily unavailable');
  const app = await startApp(server.fetch);
  assert.equal(app.$('board-error').textContent, 'Temporarily unavailable');
  assert.equal(app.$('retry').hidden, false);
  assert.equal(app.$('new-card').disabled, true);
  await app.$('retry').emit('click');
  await app.settle();
  assert.equal(app.cards().length, 1);
  assert.equal(app.$('new-card').disabled, false);
  assert.equal(app.streams[0].closed, true);
});
