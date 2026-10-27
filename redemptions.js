import WebSocket from 'ws';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const HELIX_URL = 'https://api.twitch.tv/helix';
const KEEPALIVE_GRACE_MS = 5000;

export const REDEMPTION_EVENT = 'channel.channel_points_custom_reward_redemption.add';

/**
 * Twitch tokens are configured with an `oauth:` prefix for IRC; EventSub and
 * Helix expect the bare access token.
 */
export function normalizeToken(token) {
  return String(token ?? '').replace(/^oauth:/i, '').trim();
}

export function hasRedemptionScope(scopes = []) {
  return scopes.includes('channel:read:redemptions') || scopes.includes('channel:manage:redemptions');
}

export function buildSubscriptionPayload(sessionId, broadcasterId) {
  return {
    type: REDEMPTION_EVENT,
    version: '1',
    condition: { broadcaster_user_id: String(broadcasterId) },
    transport: { method: 'websocket', session_id: sessionId },
  };
}

/**
 * Turn a redemption event into the fields worth logging.
 */
export function summarizeRedemption(event = {}, highlightReward = '') {
  const rewardTitle = event.reward?.title ?? 'Unknown reward';
  const highlight = String(highlightReward ?? '').trim().toLowerCase();

  return {
    redemptionId: event.id ?? '',
    userId: event.user_id ?? '',
    userName: event.user_name ?? event.user_login ?? 'unknown',
    rewardId: event.reward?.id ?? '',
    rewardTitle,
    cost: event.reward?.cost ?? 0,
    userInput: event.user_input ?? '',
    status: event.status ?? '',
    redeemedAt: event.redeemed_at ?? '',
    highlighted: highlight !== '' && rewardTitle.trim().toLowerCase() === highlight,
  };
}

function createHelix({ clientId, token }) {
  return async function helix(path, init = {}) {
    const response = await fetch(`${HELIX_URL}${path}`, {
      ...init,
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });

    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(body?.message || `Twitch API ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return body;
  };
}

/**
 * EventSub WebSocket client for channel point redemptions. No public URL is
 * needed: the subscription is delivered over an outgoing connection.
 */
export function createRedemptionClient({
  clientId,
  token,
  broadcasterId,
  onRedemption,
  websocketUrl = EVENTSUB_URL,
  logger = console,
} = {}) {
  const helix = createHelix({ clientId, token: normalizeToken(token) });

  let socket = null;
  let stopped = true;
  let retry = 0;
  let retryTimer = null;
  let keepaliveTimer = null;
  let keepaliveMs = 0;

  function clearTimers() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (keepaliveTimer) {
      clearTimeout(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  function stop() {
    stopped = true;
    clearTimers();
    if (socket) {
      const current = socket;
      socket = null;
      try {
        current.close();
      } catch {
        // already closed
      }
    }
  }

  function subscribe(sessionId) {
    helix('/eventsub/subscriptions', {
      method: 'POST',
      body: JSON.stringify(buildSubscriptionPayload(sessionId, broadcasterId)),
    })
      .then(() => {
        logger.log(`[redemptions] listening for redemptions (broadcaster ${broadcasterId})`);
      })
      .catch((error) => {
        if (error.status === 401 || error.status === 403) {
          logger.error(`[redemptions] subscription rejected (${error.status}): ${error.message}`);
          logger.error('[redemptions] regenerate TWITCH_TOKEN with the channel:read:redemptions scope');
          stop();
          return;
        }
        if (error.status === 409) {
          logger.warn('[redemptions] subscription already exists for this session');
          return;
        }
        logger.warn(`[redemptions] subscription failed: ${error.message}`);
      });
  }

  function resetKeepalive(ws) {
    if (!keepaliveMs) return;
    if (keepaliveTimer) clearTimeout(keepaliveTimer);
    keepaliveTimer = setTimeout(() => {
      if (ws !== socket) return;
      logger.warn('[redemptions] keepalive timeout, reconnecting');
      ws.terminate();
    }, keepaliveMs);
  }

  function handleMessage(raw, ws, resubscribe) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const type = message?.metadata?.message_type;
    const payload = message?.payload ?? {};

    if (type === 'session_welcome') {
      retry = 0;
      const seconds = payload.session?.keepalive_timeout_seconds;
      keepaliveMs = Number.isFinite(seconds) && seconds > 0
        ? (seconds * 1000) + KEEPALIVE_GRACE_MS
        : 0;
      resetKeepalive(ws);

      if (resubscribe) subscribe(payload.session?.id);
      else logger.log('[redemptions] reattached to the EventSub session');
      return;
    }

    if (type === 'session_reconnect') {
      const url = payload.session?.reconnect_url;
      if (url) connect(url, false);
      return;
    }

    if (type === 'revocation') {
      logger.warn(`[redemptions] subscription revoked: ${payload.subscription?.status ?? 'unknown'}`);
      return;
    }

    if (type === 'notification') {
      resetKeepalive(ws);
      if (payload.subscription?.type !== REDEMPTION_EVENT) return;
      try {
        onRedemption?.(payload.event);
      } catch (error) {
        logger.error(`[redemptions] handler failed: ${error.message}`);
      }
    }
  }

  function connect(url = websocketUrl, resubscribe = true) {
    if (stopped) return;

    const ws = new WebSocket(url);
    socket = ws;

    ws.on('open', () => logger.log('[redemptions] connected to Twitch EventSub'));
    ws.on('message', (data) => {
      if (ws !== socket) return;
      handleMessage(data.toString('utf8'), ws, resubscribe);
    });
    ws.on('error', (error) => {
      if (ws !== socket) return;
      logger.warn(`[redemptions] socket error: ${error.message}`);
    });
    ws.on('close', (code) => {
      if (stopped || ws !== socket) return;
      socket = null;
      if (keepaliveTimer) clearTimeout(keepaliveTimer);

      const delay = Math.min(30000, 1000 * 2 ** retry);
      retry += 1;
      logger.warn(`[redemptions] disconnected (${code}); reconnecting in ${Math.round(delay / 1000)}s`);
      retryTimer = setTimeout(() => connect(), delay);
    });
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    retry = 0;
    connect();
  }

  return { start, stop };
}

/**
 * Validate the token, resolve the broadcaster and start listening.
 * Returns null when the feature cannot run (missing scope/config).
 */
export async function startRedemptions({
  clientId,
  token,
  channel,
  broadcasterId,
  highlightReward = '',
  onRedemption,
  logger = console,
  websocketUrl = EVENTSUB_URL,
} = {}) {
  if (!clientId) {
    logger.warn('[redemptions] off: TWITCH_CLIENT_ID is not configured');
    return null;
  }

  const accessToken = normalizeToken(token);
  if (!accessToken) {
    logger.warn('[redemptions] off: TWITCH_TOKEN is empty');
    return null;
  }

  let validation;
  try {
    const response = await fetch(VALIDATE_URL, {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    validation = await response.json().catch(() => ({}));

    if (response.status === 401) {
      logger.warn('[redemptions] off: Twitch token is invalid or expired');
      return null;
    }
    if (!response.ok) {
      logger.warn(`[redemptions] off: token validation failed (${response.status})`);
      return null;
    }
  } catch (error) {
    logger.warn(`[redemptions] off: cannot validate the token (${error.message})`);
    return null;
  }

  if (!hasRedemptionScope(validation.scopes)) {
    logger.warn('[redemptions] off: token lacks channel:read:redemptions');
    logger.warn('[redemptions] regenerate TWITCH_TOKEN with chat:read, chat:edit and channel:read:redemptions');
    return null;
  }

  let resolvedBroadcasterId = broadcasterId;
  if (!resolvedBroadcasterId) {
    try {
      const helix = createHelix({ clientId, token: accessToken });
      const login = String(channel ?? '').replace(/^#/, '');
      const { data } = await helix(`/users?login=${encodeURIComponent(login)}`);
      if (!data?.length) {
        logger.warn(`[redemptions] off: broadcaster "${login}" not found`);
        return null;
      }
      resolvedBroadcasterId = data[0].id;
    } catch (error) {
      logger.warn(`[redemptions] off: cannot resolve the broadcaster (${error.message})`);
      return null;
    }
  }

  const client = createRedemptionClient({
    clientId,
    token: accessToken,
    broadcasterId: resolvedBroadcasterId,
    onRedemption,
    logger,
    websocketUrl,
  });
  client.start();
  return client;
}
