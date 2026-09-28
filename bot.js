import tmi from 'tmi.js';
import { config } from './config.js';
import { classifyMessage } from './classifier.js';

// Simple concurrency-1 queue to avoid overwhelming the Jev endpoint
let queue = Promise.resolve();
let skippedCount = 0;

function enqueue(fn) {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}

function logResult(username, message, result) {
  const { decisions } = result;
  const flagged = Object.entries(decisions)
    .filter(([, d]) => d.flagged)
    .map(([cat, d]) => `${cat}(${(d.probability * 100).toFixed(1)}%)`);

  const status = flagged.length > 0 ? `FLAGGED: ${flagged.join(', ')}` : 'clean';
  console.log(`[${username}] ${message} → ${status}`);
}

async function handleMessage(channel, tags, message, self) {
  if (self) return;

  const username = tags.username || 'unknown';
  const context = { channel: channel.slice(1), username };

  // Skip very long messages (likely pasted content)
  if (message.length > 500) {
    console.log(`[${username}] skipped (too long: ${message.length} chars)`);
    return;
  }

  try {
    const result = await enqueue(() =>
      classifyMessage(config.jev.endpoint, message, context, config.thresholds)
    );
    logResult(username, message, result);
  } catch (err) {
    console.error(`[${username}] classification failed: ${err.message}`);
    skippedCount++;
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
  console.log(`Thresholds:`, config.thresholds);
});

client.on('message', handleMessage);

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
