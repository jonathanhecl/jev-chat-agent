import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOverlayMessage,
  createOverlayServer,
  formatOverlayUrl,
  shouldOverlay,
  truncateText,
} from './overlayServer.js';

function safeDecisions() {
  return {
    insult: { flagged: false },
    spam: { flagged: false },
    toxicity: { flagged: false },
    links: { flagged: false },
    attention: { flagged: false },
  };
}

test('shouldOverlay keeps safe messages and informational attention flags', () => {
  assert.equal(shouldOverlay(safeDecisions()), true);

  const attention = safeDecisions();
  attention.attention.flagged = true;
  assert.equal(shouldOverlay(attention), true);

  assert.equal(shouldOverlay({}), true);
});

test('shouldOverlay drops any negative category', () => {
  for (const category of ['insult', 'spam', 'toxicity', 'links']) {
    const decisions = safeDecisions();
    decisions[category].flagged = true;
    assert.equal(shouldOverlay(decisions), false, category);
  }
});

test('truncateText collapses whitespace and clips long lines', () => {
  assert.equal(truncateText('  hello \n  world  '), 'hello world');
  assert.equal(truncateText(''), '');
  assert.equal(truncateText(null), '');

  const clipped = truncateText('a'.repeat(200), 20);
  assert.equal(clipped.length, 20);
  assert.ok(clipped.endsWith('…'));
});

test('createOverlayMessage flags attention-only messages for the blue glow', () => {
  const message = createOverlayMessage(
    'alice',
    '  cuando juega?  ',
    { attention: { flagged: true }, insult: { flagged: false } }
  );
  assert.equal(message.type, 'message');
  assert.equal(message.username, 'alice');
  assert.equal(message.text, 'cuando juega?');
  assert.equal(message.attention, true);
  assert.equal(typeof message.ts, 'number');

  const plain = createOverlayMessage('bob', 'gg', { attention: { flagged: false } }, 20);
  assert.equal(plain.attention, false);
  assert.equal(plain.text, 'gg');

  assert.equal(createOverlayMessage('carol', 'hi', undefined).attention, false);
});

test('formatOverlayUrl rewrites wildcard bind addresses', () => {
  assert.equal(formatOverlayUrl('127.0.0.1', 3000), 'http://127.0.0.1:3000/');
  assert.equal(formatOverlayUrl('0.0.0.0', 3000), 'http://127.0.0.1:3000/');
  assert.equal(formatOverlayUrl('::', 3000), 'http://127.0.0.1:3000/');
  assert.equal(formatOverlayUrl('::1', 3000), 'http://[::1]:3000/');
});

async function startServer(t) {
  const overlay = createOverlayServer({ host: '127.0.0.1', port: 0 });
  await overlay.listen();
  t.after(() => overlay.close());
  return { overlay, base: `http://127.0.0.1:${overlay.port}` };
}

test('serves the overlay page and refuses path traversal', async (t) => {
  const { base } = await startServer(t);

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /id="stage"/);

  const script = await fetch(`${base}/overlay.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /text\/javascript/);

  const missing = await fetch(`${base}/nope.txt`);
  assert.equal(missing.status, 404);

  const traversal = await fetch(`${base}/%2e%2e%2fpackage.json`);
  assert.equal(traversal.status, 403);
});

test('health endpoint reports connected clients', async (t) => {
  const { base } = await startServer(t);

  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, clients: 0 });
});

test('broadcast streams messages to SSE clients', async (t) => {
  const { overlay, base } = await startServer(t);
  const controller = new AbortController();
  t.after(() => controller.abort());

  const response = await fetch(`${base}/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function readUntil(predicate) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (predicate(buffer)) return buffer;
    }
    throw new Error(`stream timeout, received: ${JSON.stringify(buffer)}`);
  }

  await readUntil((text) => text.includes(': connected'));
  assert.equal(overlay.clients, 1);

  overlay.broadcast({ type: 'message', username: 'alice', text: 'hola mundo', ts: 1 });

  const received = await readUntil((text) => text.includes('hola mundo'));
  assert.match(received, /event: message/);
  assert.match(received, /data: \{"type":"message","username":"alice","text":"hola mundo","ts":1\}/);
});
