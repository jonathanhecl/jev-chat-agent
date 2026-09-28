import tmi from 'tmi.js';
import { config } from './config.js';
import { classifyMessage } from './classifier.js';

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
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

// Categories that are informational only (no moderation action, no chat message)
const INFO_CATEGORIES = new Set(['atencion']);

function logResult(username, message, result, elapsedMs) {
  const { decisions } = result;

  // Split into actionable flags and informational flags
  const actionable = Object.entries(decisions).filter(([, d]) => d.flagged && !INFO_CATEGORIES.has([0]));
  const informational = Object.entries(decisions).filter(([, d]) => d.flagged && INFO_CATEGORIES.has([0]));

  const isClean = actionable.length === 0;
  const color = isClean ? GREEN : RED;

  // Build percentage string for each category, bold if flagged
  // Re-apply the bracket color after bold reset to keep the bracket colored
  const parts = Object.entries(decisions).map(([cat, d]) => {
    const pct = (d.probability * 100).toFixed(1);
    const label = `${cat} ${pct}%`;
    if (!d.flagged) return label;
    const catColor = INFO_CATEGORIES.has(cat) ? YELLOW : color;
    return `${BOLD}${label}${catColor}`;
  });

  const timing = elapsedMs !== undefined ? ` ${DIM}[${elapsedMs}ms]${RESET}` : '';

  // Build info suffix for informational categories
  const infoStr = informational.length > 0
    ? ` ${YELLOW}ℹ ${informational.map(([cat, d]) => `${cat} ${(d.probability * 100).toFixed(0)}%`).join(', ')}${RESET}`
    : '';

  console.log(`[${username}] ${message} → ${color}[${parts.join(', ')}]${RESET}${infoStr}${timing}`);
}

async function sendChatMessage(client, channel, tags, result) {
  const { decisions } = result;
  const flagged = Object.entries(decisions).filter(([, d]) => d.flagged && !INFO_CATEGORIES.has([0]));

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
  const flagged = Object.entries(decisions).filter(([, d]) => d.flagged && !INFO_CATEGORIES.has([0]));

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
    return;
  }

  // Skip excluded users
  if (config.excludedUsers.includes(username.toLowerCase())) {
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
      classifyMessage(config.jev.endpoint, message, context, config.thresholds, recentBuffer)
    );
    const elapsed = Date.now() - start;
    logResult(username, message, result, elapsed);

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

const client = new tmi.Client({
  options: { debug: false },
  identity: {
    username: config.twitch.username,
    password: config.twitch.token,
  },
  channels: [config.twitch.channel],
});

client.on('connected', (addr, port) => {
  console.log(`Connected to ${addr}:${port}`);
  console.log(`Monitoring #${config.twitch.channel} — Jev endpoint: ${config.jev.endpoint}`);
  console.log(`Moderation: ${config.moderation.enabled ? 'ENABLED' : 'DISABLED (log only)'}`);
  console.log(`Chat messages: ${config.chatMessages.enabled ? 'ENABLED' : 'DISABLED'}`);
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
  process.exit(0);
});
