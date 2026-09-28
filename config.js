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
  if (isNaN(value) || value < 0 || value > 1) {
    throw new Error(`Invalid threshold for ${name}: ${raw}`);
  }
  return value;
}

export const config = {
  twitch: {
    channel: getEnv('TWITCH_CHANNEL'),
    username: getEnv('TWITCH_USERNAME'),
    token: getEnv('TWITCH_TOKEN'),
  },
  jev: {
    endpoint: getEnv('JEV_ENDPOINT', 'http://mac-mini.local:8765/v1/systemone'),
  },
  thresholds: {
    insulto: getThreshold('JEV_THRESHOLD_INSULTO'),
    spam: getThreshold('JEV_THRESHOLD_SPAM'),
    toxicidad: getThreshold('JEV_THRESHOLD_TOXICIDAD'),
    links: getThreshold('JEV_THRESHOLD_LINKS'),
  },
};
