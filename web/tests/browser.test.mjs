import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startFixture } from './fixture.mjs';

async function browserBinary() {
  const candidates = [process.env.BROWSER_BIN, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  for (const path of candidates) { try { await access(path); return path; } catch {} }
  return null;
}

async function until(callback, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await callback()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${message}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const events = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method) events.set(message.method, message.params);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(requestId, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  return {
    call, errors, events, close: () => socket.close(),
    async evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
  };
}

test('browser: CRUD, server errors, drag order, keyboard moves, live tabs and reconnect', { timeout: 60000 }, async context => {
  const binary = await browserBinary();
  if (!binary) { context.skip('Set BROWSER_BIN to a Chromium browser to run the browser test.'); return; }
  const fixture = await startFixture();
  const profile = await mkdtemp(join(tmpdir(), 'team-board-browser-'));
  let browser;
  const tabs = [];
  const processHandle = spawn(binary, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let launchError;
  processHandle.on('error', error => { launchError = error; });
  try {
    let port;
    await until(async () => {
      if (launchError) throw launchError;
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port; } catch { return false; }
    }, 'browser startup');
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    browser = await connect(info.webSocketDebuggerUrl);
    async function newTab() {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(fixture.url)}`, { method: 'PUT' })).json();
      const tab = await connect(target.webSocketDebuggerUrl);
      tabs.push(tab);
      await tab.call('Runtime.enable');
      await tab.call('Page.enable');
      await until(() => tab.evaluate(`document.querySelectorAll('.column').length === 3 && !document.getElementById('new-card').disabled`), 'board load');
      return tab;
    }
    const first = await newTab();
    const second = await newTab();
    const click = (tab, selector) => tab.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const fill = (tab, selector, value) => tab.evaluate(`document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}`);
    const submit = tab => tab.evaluate(`document.getElementById('card-form').requestSubmit()`);
    const waitClosed = tab => until(() => tab.evaluate(`!document.getElementById('card-dialog').open`), 'editor saved');

    await click(first, '#new-card');
    await submit(first);
    await until(() => first.evaluate(`!document.getElementById('title-error').hidden`), 'inline server validation');
    assert.equal(await first.evaluate(`document.getElementById('title-error').textContent`), 'Title must contain 1–80 characters.');
    assert.equal(await first.evaluate(`document.activeElement.id`), 'title');
    await fill(first, '#title', '<img src=x onerror=alert(1)>');
    await fill(first, '#description', 'Plan the next release');
    await fill(first, '#assignee', 'Alex Morgan');
    await submit(first);
    await waitClosed(first);
    await until(() => second.evaluate(`document.querySelectorAll('.card').length === 1`), 'live create in second tab');
    assert.equal(await second.evaluate(`document.querySelector('.card-title').textContent`), '<img src=x onerror=alert(1)>');
    assert.equal(await second.evaluate(`document.querySelectorAll('.card img').length`), 0, 'card content is plain text');

    await click(second, '.card-open');
    await fill(second, '#title', 'Ship the board');
    await fill(second, '#description', 'Reviewed by the team');
    await fill(second, '#assignee', 'Sam Lee');
    await submit(second);
    await waitClosed(second);
    await until(() => first.evaluate(`document.querySelector('.card-title').textContent === 'Ship the board'`), 'live edit');
    assert.equal(await first.evaluate(`document.querySelector('.card-footer').textContent`), 'SLSam Lee');

    fixture.create({ title: 'Second task' });
    fixture.create({ title: 'Third task' });
    await until(() => first.evaluate(`document.querySelectorAll('.card').length === 3`), 'teammate creates');
    async function drag(sourceId, column, beforeId) {
      await first.evaluate(`(() => {
        const source = document.querySelector('.card[data-card-id="${sourceId}"]');
        const column = document.querySelector('.column[data-column="${column}"]');
        const before = ${beforeId ? `document.querySelector('.card[data-card-id="${beforeId}"]')` : 'null'};
        const y = before ? before.getBoundingClientRect().top + 1 : column.getBoundingClientRect().bottom + 50;
        const dataTransfer = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', {bubbles:true, cancelable:true, dataTransfer}));
        column.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer, clientY:y}));
        column.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer, clientY:y}));
        source.dispatchEvent(new DragEvent('dragend', {bubbles:true, dataTransfer}));
      })()`);
      await until(() => fixture.requests.some(request => request.method === 'PATCH' && request.path === `/api/cards/${sourceId}` && request.body.column === column), 'drag PATCH');
      await until(() => first.evaluate(`document.querySelector('.card[data-card-id="${sourceId}"]').closest('.column').dataset.column === '${column}'`), 'drag render');
    }
    await drag('1', 'todo');
    await until(() => first.evaluate(`document.querySelector('.column[data-column="todo"] .card:last-child').dataset.cardId === '1'`), 'same-column bottom reorder');
    assert.deepEqual(fixture.requests.filter(request => request.method === 'PATCH').at(-1).body, { column: 'todo', position: 2 });
    await drag('1', 'todo', '2');
    await until(() => first.evaluate(`document.querySelector('.column[data-column="todo"] .card').dataset.cardId === '1'`), 'same-column upward reorder');
    assert.deepEqual(fixture.requests.filter(request => request.method === 'PATCH').at(-1).body, { column: 'todo', position: 0 });
    await drag('1', 'in-progress');
    await until(() => second.evaluate(`document.querySelector('.column[data-column="in-progress"] .card')?.dataset.cardId === '1'`), 'live drag to empty column');

    await click(first, '.card-open[data-card-id="1"]');
    await fill(first, '#column', 'done');
    await first.evaluate(`document.getElementById('column').dispatchEvent(new Event('change'))`);
    await submit(first);
    await waitClosed(first);
    await until(() => second.evaluate(`document.querySelector('.column[data-column="done"] .card')?.dataset.cardId === '1'`), 'keyboard move');

    // The open editor must retain unsaved work while another tab changes the board.
    await click(first, '.card-open[data-card-id="1"]');
    await fill(first, '#description', 'My unsaved note');
    fixture.create({ title: 'Arrives while editing' });
    await until(() => first.evaluate(`document.querySelectorAll('.card').length === 4`), 'live update during editing');
    assert.equal(await first.evaluate(`document.getElementById('description').value`), 'My unsaved note');
    await click(first, '#cancel');

    fixture.disconnect();
    fixture.create({ title: 'Created during disconnect' });
    await until(() => second.evaluate(`document.querySelectorAll('.card').length === 5`), 'SSE reconnect full refetch', 12000);
    await click(first, '.card-open[data-card-id="1"]');
    await click(first, '#delete-card');
    await click(first, '#confirm-delete');
    await until(() => second.evaluate(`!document.querySelector('.card[data-card-id="1"]')`), 'live delete');

    // Exercise Chromium's native drag path, starting over the card's edit button.
    await first.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await first.call('Page.bringToFront');
    await first.call('Input.setInterceptDrags', { enabled: true });
    const points = await first.evaluate(`(() => {
      const source = document.querySelector('.card[data-card-id="3"]').getBoundingClientRect();
      const target = document.querySelector('.column[data-column="done"] .card-list').getBoundingClientRect();
      return {sx: source.x + source.width / 2, sy: source.y + 25, tx: target.x + target.width / 2, ty: target.y + 30};
    })()`);
    await first.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.sx, y: points.sy });
    await first.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: points.sx, y: points.sy, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 12; step++) {
      await first.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.sx + (points.tx - points.sx) * step / 12, y: points.sy + (points.ty - points.sy) * step / 12, button: 'left', buttons: 1 });
      await delay(20);
    }
    await until(() => first.events.has('Input.dragIntercepted'), 'native drag start');
    const dragData = first.events.get('Input.dragIntercepted').data;
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await first.call('Input.dispatchDragEvent', { type, x: points.tx, y: points.ty, data: dragData });
    }
    await first.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: points.tx, y: points.ty, button: 'left', clickCount: 1 });
    await first.call('Input.setInterceptDrags', { enabled: false });
    await until(() => second.evaluate(`document.querySelector('.column[data-column="done"] .card')?.dataset.cardId === '3'`), 'native mouse drag');

    await first.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await first.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'mobile page fits viewport');
    assert.equal(await first.evaluate(`document.querySelector('.board').scrollWidth > document.querySelector('.board').clientWidth`), true, 'columns scroll within board');
    await first.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    if (process.env.BOARD_SCREENSHOT) {
      const screenshot = await first.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(process.env.BOARD_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }
    for (const tab of tabs) assert.deepEqual(tab.errors, [], 'no uncaught browser exceptions');
  } finally {
    for (const tab of tabs) tab.close();
    try { await browser?.call('Browser.close'); } catch {}
    browser?.close();
    processHandle.kill();
    await fixture.close();
    await delay(300);
    // Only remove the unique profile directory created inside the OS temp root.
    if (resolve(profile).startsWith(resolve(tmpdir()) + sep)) {
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});
