import { decideMany } from './jevClient.js';

const QUESTIONS = {
  insulto: {
    instructions: '¿Es este mensaje un insulto o lenguaje ofensivo dirigido a otro usuario?',
  },
  spam: {
    instructions: '¿Es este mensaje spam (publicación repetitiva, promoción no solicitada, o contenido sin sentido)?',
  },
  toxicidad: {
    instructions: '¿Es este mensaje tóxico (lenguaje dañino, acoso, o contenido perturbador)?',
  },
  links: {
    instructions: '¿Contiene este mensaje enlaces o URLs no permitidos?',
  },
};

/**
 * Build the state text from a chat message and optional context.
 */
export function buildState(message, context = {}) {
  const parts = [];
  if (context.channel) parts.push(`#${context.channel}`);
  if (context.username) parts.push(`@${context.username}`);
  parts.push(message);
  return parts.join(' ');
}

/**
 * Classify a chat message using Jev.
 * Returns an object with probabilities and boolean decisions per category.
 */
export async function classifyMessage(endpoint, message, context, thresholds) {
  const state = buildState(message, context);
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
