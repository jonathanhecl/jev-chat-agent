import tmi from 'tmi.js';
import { config } from './config.js';
import { classifyMessage } from './classifier.js';
import {
  createOverlayMessage,
  formatOverlayUrl,
  shouldOverlay,
  startOverlayServer,
} from './overlayServer.js';
import { startRedemptions, summarizeRedemption } from './redemptions.js';

// Simple concurrency-1 queue to avoid overwhelming the Jev endpoint
let queue = Promise.resolve();

// Buffer of recent messages for context
const recentBuffer = [];

function enqueue(fn) {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}

function pushRecent(username, message) {
  recentBuffer.push({ username, message, ts: Date.now() });
  const max = config.context.messageCount;
  while (recentBuffer.length > max) {
    recentBuffer.shift();
  }
}

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const ORANGE = '\x1b[38;5;208m';
const WHITE = '\x1b[37m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const CATEGORY_COLORS = {
  insult: RED,
  spam: ORANGE,
  toxicity: MAGENTA,
  links: CYAN,
  attention: YELLOW,
};

// Categories that are informational only (no moderation action, no chat message)
const INFO_CATEGORIES = new Set(['attention']);

function logResult(username, message, result, elapsedMs) {
  const { decisions } = result;

  // Collect informational flags
  const informational = Object.entries(decisions).filter(([cat, d]) => d.flagged && INFO_CATEGORIES.has(cat));

  // Color by the dominant category (highest probability), white when all are low
  const allEntries = Object.entries(decisions);
  const dominant = allEntries.reduce((a, b) => (a[1].probability > b[1].probability ? a : b));
  const lowConfidence = allEntries.every(([cat, d]) => d.probability < (config.thresholds[cat] ?? 0.7) / 2);
  const color = lowConfidence ? WHITE : CATEGORY_COLORS[dominant[0]] || GREEN;

  // Build percentage string for each category, bold if flagged
  // Re-apply the bracket color after bold reset to keep the bracket colored
  const parts = Object.entries(decisions).map(([cat, d]) => {
    const pct = (d.probability * 100).toFixed(1);
    const label = `${cat} ${pct}%`;
    if (!d.flagged) return label;
    return `${BOLD}${label}${RESET}${color}`;
  });

  const timing = elapsedMs !== undefined ? ` ${DIM}[${elapsedMs}ms]${RESET}` : '';

  // Build info suffix for informational categories
  const infoStr = informational.length > 0
    ? ` ${YELLOW}ℹ ${informational.map(([cat, d]) => `${cat} ${(d.probability * 100).toFixed(0)}%`).join(', ')}${RESET}`
    : '';

  console.log(`[${username}] ${message} → ${color}[${parts.join(', ')}]${RESET}${infoStr}${timing}`);
}

function logRedemption(redemption) {
  const reward = redemption.highlighted
    ? `${BOLD}${YELLOW}${redemption.rewardTitle}${RESET}`
    : redemption.rewardTitle;
  const input = redemption.userInput ? ` ${DIM}· "${redemption.userInput}"${RESET}` : '';

  console.log(
    `${MAGENTA}🎁 redemption${RESET} ${BOLD}${redemption.userName}${RESET} → ` +
      `${reward} (${redemption.cost} pts)${input}`
  );
}

async function sendChatMessage(client, channel, tags, result) {
  const { decisions } = result;
  const flagged = Object.entries(decisions).filter(([cat, d]) => d.flagged && !INFO_CATEGORIES.has(cat));

  if (flagged.length === 0) return;

  const parts = flagged.map(([cat, d]) => `${cat} ${(d.probability * 100).toFixed(0)}%`);
  const text = `@${tags.username} ⚠ ${parts.join(', ')}`;

  try {
    await client.say(channel, text);
    console.log(`  ↳ chat: ${text}`);
  } catch (err) {
    console.error(`  ↳ failed to send chat message: ${err.message}`);
  }
}

async function moderate(client, channel, tags, message, result) {
  const { decisions } = result;
  const flagged = Object.entries(decisions).filter(([cat, d]) => d.flagged && !INFO_CATEGORIES.has(cat));

  if (flagged.length === 0) return;

  const categories = flagged.map(([cat]) => cat).join(', ');

  // Delete the message
  try {
    await client.deletemessage(channel, tags.id);
    console.log(`  ↳ deleted message (${categories})`);
  } catch (err) {
    console.error(`  ↳ failed to delete: ${err.message}`);
  }

  // Timeout the user (300s)
  try {
    await client.timeout(channel, tags.username, 300, `Jev flagged: ${categories}`);
    console.log(`  ↳ timed out ${tags.username} for 300s`);
  } catch (err) {
    console.error(`  ↳ failed to timeout: ${err.message}`);
  }
}

async function handleMessage(channel, tags, message, self, client) {
  if (self) return;

  const username = tags.username || 'unknown';

  // Skip the channel host itself
  if (username.toLowerCase() === config.twitch.channel.toLowerCase()) {
    console.log(`[${username}] ${message} ${DIM}(host)${RESET}`);
    return;
  }

  // Skip excluded users
  if (config.excludedUsers.includes(username.toLowerCase())) {
    console.log(`[${username}] ${message} ${DIM}(excluded)${RESET}`);
    return;
  }

  const context = { channel: channel.slice(1), username };

  // Skip very long messages (likely pasted content)
  if (message.length > 500) {
    console.log(`[${username}] skipped (too long: ${message.length} chars)`);
    return;
  }

  try {
    const start = Date.now();
    const result = await enqueue(() =>
      classifyMessage(config.jev.endpoint, message, context, config.thresholds, recentBuffer, config.jev.model)
    );
    const elapsed = Date.now() - start;
    logResult(username, message, result, elapsed);

    if (overlay && shouldOverlay(result.decisions)) {
      overlay.broadcast(
        createOverlayMessage(username, message, result.decisions, config.overlay.maxChars)
      );
    }

    if (config.chatMessages.enabled) {
      await sendChatMessage(client, channel, tags, result);
    }

    if (config.moderation.enabled) {
      await moderate(client, channel, tags, message, result);
    }
  } catch (err) {
    console.error(`[${username}] classification failed: ${err.message}`);
  } finally {
    pushRecent(username, message);
  }
}

let overlay = null;

if (config.overlay.enabled) {
  startOverlayServer({ host: config.overlay.host, port: config.overlay.port })
    .then((instance) => {
      overlay = instance;
      const url = formatOverlayUrl(config.overlay.host, instance.port);
      console.log(`Overlay widget: ${url}  (demo: ${url}?demo=1)`);
    })
    .catch((err) => {
      console.error(`Overlay server failed to start: ${err.message}`);
    });
}

let redemptions = null;

if (config.redemptions.enabled) {
  startRedemptions({
    clientId: config.twitch.clientId,
    token: config.twitch.token,
    channel: config.twitch.channel,
    highlightReward: config.redemptions.highlightReward,
    onRedemption: (event) =>
      logRedemption(summarizeRedemption(event, config.redemptions.highlightReward)),
  })
    .then((instance) => {
      redemptions = instance;
    })
    .catch((err) => {
      console.error(`[redemptions] failed to start: ${err.message}`);
    });
}

const client = new tmi.Client({
  options: { debug: false },
  identity: {
    username: config.twitch.username,
    password: config.twitch.token,
  },
  channels: [config.twitch.channel],
});

client.on('connected', (addr, port) => {
  console.log(`Connected to Twitch`); // ${addr}:${port}
  console.log(`Monitoring #${config.twitch.channel} — Jev endpoint: ${config.jev.endpoint}`);
  console.log(`Moderation: ${config.moderation.enabled ? 'ENABLED' : 'DISABLED (log only)'}`);
  console.log(`Chat messages: ${config.chatMessages.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Overlay: ${config.overlay.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Redemptions: ${config.redemptions.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Thresholds:`, config.thresholds);
});

client.on('message', (channel, tags, message, self) => {
  handleMessage(channel, tags, message, self, client);
});

client.on('error', (err) => {
  console.error('Twitch client error:', err.message);
});

client.connect().catch((err) => {
  console.error('Failed to connect to Twitch:', err.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nDisconnecting...');
  client.disconnect();
  if (overlay) overlay.close().catch(() => {});
  if (redemptions) redemptions.stop();
  process.exit(0);
});
