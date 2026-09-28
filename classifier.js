import { decideMany } from './jevClient.js';

const QUESTIONS = {
  insulto: {
    instructions: '¿Es este mensaje un insulto o lenguaje ofensivo dirigido a otro usuario?',
  },
  spam: {
    instructions: '¿Es este mensaje spam de chat: mismo texto repetido muchas veces, promoción de canales/productos/servicios, o enlaces publicitarios? Ignora risas (ajajaja), teclazos aleatorios y mensajes cortos normales.',
  },
  toxicidad: {
    instructions: '¿Es este mensaje tóxico (lenguaje dañino, acoso, o contenido perturbador)?',
  },
  links: {
    instructions: '¿Contiene este mensaje enlaces o URLs no permitidos?',
  },
};

/**
 * Build the state text from a chat message and recent context.
 */
export function buildState(message, context = {}, recentMessages = []) {
  const lines = [];

  if (recentMessages.length > 0) {
    lines.push('Mensajes recientes:');
    for (const msg of recentMessages) {
      lines.push(`[${msg.username}]: ${msg.message}`);
    }
    lines.push('');
  }

  lines.push('Mensaje actual:');
  if (context.channel) lines.push(`#${context.channel}`);
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
