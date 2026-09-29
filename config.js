import 'dotenv/config';

function getEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getThreshold(name) {
  const raw = getEnv(name, '0.7');
  const value = parseFloat(raw);
  if (isNaN(value) || value < 0) {
    throw new Error(`Invalid threshold for ${name}: ${raw}`);
  }
  // Values > 1 mean the category is disabled (never flagged)
  return value;
}

export const config = {
  twitch: {
    channel: getEnv('TWITCH_CHANNEL'),
    username: getEnv('TWITCH_USERNAME'),
    token: getEnv('TWITCH_TOKEN'),
  },
  jev: {
    endpoint: getEnv('JEV_ENDPOINT', 'http://localhost:8765/v1/systemone'),
  },
  moderation: {
    enabled: getEnv('MODERATION_ENABLED', 'false') === 'true',
  },
  chatMessages: {
    enabled: getEnv('CHAT_MESSAGES_ENABLED', 'false') === 'true',
  },
  context: {
    messageCount: parseInt(getEnv('JEV_CONTEXT_MESSAGES', '3'), 10) || 3,
  },
  excludedUsers: getEnv('JEV_EXCLUDED_USERS', '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean),
  thresholds: {
    insult: getThreshold('JEV_THRESHOLD_INSULT'),
    spam: getThreshold('JEV_THRESHOLD_SPAM'),
    toxicity: getThreshold('JEV_THRESHOLD_TOXICITY'),
    links: getThreshold('JEV_THRESHOLD_LINKS'),
    attention: getThreshold('JEV_THRESHOLD_ATTENTION'),
  },
};
