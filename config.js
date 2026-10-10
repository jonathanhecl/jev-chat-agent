import 'dotenv/config';

function getEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const JEV_PATH = '/v1/systemone';

function getJevEndpoint(raw) {
  const value = raw.trim();
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) ? value : `http://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Invalid JEV_ENDPOINT');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid JEV_ENDPOINT');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid JEV_ENDPOINT');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '' && path !== JEV_PATH) {
    throw new Error('Invalid JEV_ENDPOINT');
  }
  const authority = value
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0];
  const explicitPort = /:\d+$/.test(authority);
  const host = explicitPort ? url.host : `${url.host}:11434`;
  return `${url.protocol}//${host}${JEV_PATH}`;
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
    endpoint: getJevEndpoint(getEnv('JEV_ENDPOINT', 'localhost')),
    model: getEnv('JEV_MODEL'),
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
