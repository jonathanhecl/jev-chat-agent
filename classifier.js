import { decideMany } from './jevClient.js';

const QUESTIONS = {
  insulto: {
    instructions: '¿Es este mensaje un insulto o lenguaje ofensivo dirigido a otro usuario?',
  },
  spam: {
    instructions: '¿Es este mensaje spam de chat? Spam es: promoción de canales/productos/servicios',
  },
  toxicidad: {
    instructions: '¿Es este mensaje tóxico (lenguaje dañino, acoso, o contenido perturbador)?',
  },
  links: {
    instructions: '¿Contiene este mensaje enlaces o URLs?',
  },
  atencion: {
    instructions: '¿Es este mensaje una pregunta o consulta dirigida al streamer que requiere su atención? Incluye: menciones directas al streamer (@nombre), preguntas sobre el stream/juego, o saludos al canal. Ejemplos: "@streamer ¿qué juego es este?", "¿cuándo es el próximo stream?", "saludos desde México".',
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
  if (context.channel) lines.push(`Canal: #${context.channel}`);
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
