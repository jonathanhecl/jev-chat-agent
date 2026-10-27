import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import {
  buildSubscriptionPayload,
  createRedemptionClient,
  hasRedemptionScope,
  normalizeToken,
  startRedemptions,
  summarizeRedemption,
} from './redemptions.js';

const silentLogger = { log() {}, warn() {}, error() {} };

function stubFetch(t, impl) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return impl(String(url), options);
  };
  t.after(() => {
    globalThis.fetch = original;
  });

  return calls;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body ?? {},
  };
}

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function startLocalSocket(t) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  t.after(() => {
    for (const client of wss.clients) client.terminate();
    return new Promise((resolve) => wss.close(resolve));
  });
  return wss;
}

test('normalizes tokens and detects redemption scopes', () => {
  assert.equal(normalizeToken('oauth:abc123'), 'abc123');
  assert.equal(normalizeToken('abc123'), 'abc123');
  assert.equal(normalizeToken(undefined), '');

  assert.equal(hasRedemptionScope(['chat:read', 'channel:read:redemptions']), true);
  assert.equal(hasRedemptionScope(['channel:manage:redemptions']), true);
  assert.equal(hasRedemptionScope(['chat:read']), false);
  assert.equal(hasRedemptionScope(), false);
});

test('builds the websocket subscription payload', () => {
  assert.deepEqual(buildSubscriptionPayload('sess-1', '123'), {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    condition: { broadcaster_user_id: '123' },
    transport: { method: 'websocket', session_id: 'sess-1' },
  });
});

test('summarizes a redemption and highlights the configured reward', () => {
  const event = {
    id: 'redemption-1',
    user_id: '42',
    user_name: 'alice',
    user_input: 'hola',
    status: 'unfulfilled',
    redeemed_at: '2026-01-01T00:00:00Z',
    reward: { id: 'reward-1', title: 'Voz de Scorpion', cost: 500 },
  };

  const summary = summarizeRedemption(event, '  voz de scorpion ');
  assert.equal(summary.userName, 'alice');
  assert.equal(summary.rewardTitle, 'Voz de Scorpion');
  assert.equal(summary.cost, 500);
  assert.equal(summary.userInput, 'hola');
  assert.equal(summary.highlighted, true);

  assert.equal(summarizeRedemption(event, 'otra cosa').highlighted, false);
  assert.equal(summarizeRedemption({}, '').rewardTitle, 'Unknown reward');
});

test('subscribes on welcome and forwards redemption notifications', async (t) => {
  const wss = await startLocalSocket(t);
  const calls = stubFetch(t, async () => jsonResponse(202, {}));

  const received = [];
  const client = createRedemptionClient({
    clientId: 'client-id',
    token: 'oauth:token',
    broadcasterId: '123',
    websocketUrl: `ws://127.0.0.1:${wss.address().port}`,
    onRedemption: (event) => received.push(event),
    logger: silentLogger,
  });

  client.start();
  t.after(() => client.stop());

  await waitFor(() => wss.clients.size === 1);
  const [socket] = wss.clients;

  socket.send(JSON.stringify({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'sess-1', keepalive_timeout_seconds: 10 } },
  }));

  await waitFor(() => calls.length === 1);
  assert.match(calls[0].url, /\/helix\/eventsub\/subscriptions$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), buildSubscriptionPayload('sess-1', '123'));

  socket.send(JSON.stringify({
    metadata: { message_type: 'notification' },
    payload: {
      subscription: { type: 'channel.channel_points_custom_reward_redemption.add' },
      event: { user_name: 'alice', reward: { title: 'Voz de Scorpion', cost: 500 } },
    },
  }));

  await waitFor(() => received.length === 1);
  assert.equal(received[0].user_name, 'alice');
});

test('startRedemptions refuses a token without the redemption scope', async (t) => {
  stubFetch(t, async () => jsonResponse(200, { scopes: ['chat:read', 'chat:edit'] }));

  const warnings = [];
  const logger = {
    log() {},
    warn: (message) => warnings.push(message),
    error: (message) => warnings.push(message),
  };

  const client = await startRedemptions({
    clientId: 'client-id',
    token: 'oauth:token',
    channel: 'hide_zone',
    logger,
  });

  assert.equal(client, null);
  assert.ok(warnings.some((message) => message.includes('channel:read:redemptions')));
});

test('startRedemptions resolves the broadcaster before subscribing', async (t) => {
  const wss = await startLocalSocket(t);
  const calls = stubFetch(t, async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      return jsonResponse(200, { scopes: ['chat:read', 'channel:read:redemptions'] });
    }
    if (url.startsWith('https://api.twitch.tv/helix/users?login=hide_zone')) {
      return jsonResponse(200, { data: [{ id: '57209351', login: 'hide_zone' }] });
    }
    return jsonResponse(202, {});
  });

  const client = await startRedemptions({
    clientId: 'client-id',
    token: 'oauth:token',
    channel: 'hide_zone',
    websocketUrl: `ws://127.0.0.1:${wss.address().port}`,
    logger: silentLogger,
  });

  assert.ok(client);
  t.after(() => client.stop());

  await waitFor(() => wss.clients.size === 1);
  assert.ok(calls.some((call) => call.url.includes('/helix/users?login=hide_zone')));

  wss.clients.forEach((socket) => socket.send(JSON.stringify({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'sess-2' } },
  })));

  await waitFor(() => calls.some((call) => call.url.endsWith('/helix/eventsub/subscriptions')));
  const subscription = calls.find((call) => call.url.endsWith('/helix/eventsub/subscriptions'));
  assert.deepEqual(JSON.parse(subscription.options.body).condition, {
    broadcaster_user_id: '57209351',
  });
});
