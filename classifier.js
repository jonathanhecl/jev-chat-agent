import { decideMany } from './jevClient.js';

const QUESTIONS = {
  insult: {
    instructions: 'Is this message an insult or offensive language directed at another user?',
  },
  spam: {
    instructions: 'Is this message chat spam? Spam is: promotion of channels/products/services',
  },
  toxicity: {
    instructions: 'Is this message toxic (harmful language, harassment, or disturbing content)?',
  },
  links: {
    instructions: 'Does this message contain links or URLs?',
  },
  attention: {
    instructions: 'Is this message a question or request directed at the streamer that requires their attention? Includes: direct mentions of the streamer (@name), questions about the stream/game, or greetings to the channel. Examples: "@streamer what game is this?", "when is the next stream?", "greetings from Mexico".',
  },
};

/**
 * Build the state text from a chat message and recent context.
 */
export function buildState(message, context = {}, recentMessages = []) {
  const lines = [];

  if (recentMessages.length > 0) {
    lines.push('Recent messages:');
    for (const msg of recentMessages) {
      lines.push(`[${msg.username}]: ${msg.message}`);
    }
    lines.push('');
  }

  lines.push('Current message:');
  if (context.channel) lines.push(`Channel: #${context.channel}`);
  if (context.username) lines.push(`[${context.username}]: ${message}`);

  return lines.join('\n');
}

/**
 * Classify a chat message using Jev.
 * Returns an object with probabilities and boolean decisions per category.
 */
export async function classifyMessage(endpoint, message, context, thresholds, recentMessages = []) {
  const state = buildState(message, context, recentMessages);
  const probabilities = await decideMany(endpoint, state, QUESTIONS);

  const decisions = {};
  for (const [id, q] of Object.entries(QUESTIONS)) {
    const prob = probabilities[id] ?? 0;
    decisions[id] = {
      probability: prob,
      flagged: prob >= (thresholds[id] ?? 0.7),
    };
  }

  return { probabilities, decisions };
}
