import { decideMany } from './jevClient.js';

const QUESTIONS = [
  { id: 'insulto', question: '¿Es este mensaje un insulto o lenguaje ofensivo dirigido a otro usuario?' },
  { id: 'spam', question: '¿Es este mensaje spam (publicación repetitiva, promoción no solicitada, o contenido sin sentido)?' },
  { id: 'toxicidad', question: '¿Es este mensaje tóxico (lenguaje dañino, acoso, o contenido perturbador)?' },
  { id: 'links', question: '¿Contiene este mensaje enlaces o URLs no permitidos?' },
];

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
  for (const q of QUESTIONS) {
    const prob = probabilities[q.id] ?? 0;
    decisions[q.id] = {
      probability: prob,
      flagged: prob >= (thresholds[q.id] ?? 0.7),
    };
  }

  return { probabilities, decisions };
}
