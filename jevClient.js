/**
 * Lightweight HTTP client for the Jev-Style decision endpoint.
 * Uses native fetch — no heavy dependencies.
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the Jev endpoint with a state and multiple noul (yes/no) questions.
 * Uses decide_many semantics: one call, state computed once.
 *
 * @param {string} endpoint - Full URL of the /v1/systemone endpoint
 * @param {string} state - The context/state text
 * @param {Array<{id: string, question: string}>} questions - noul questions
 * @returns {Object} Map of questionId -> boolean probability
 */
export async function decideMany(endpoint, state, questions) {
  const payload = {
    state,
    questions: questions.map((q) => ({
      t: 'noul',
      ins: q.question,
      crit: null,
    })),
  };

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return parseResponse(data, questions);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * attempt;
        console.warn(`[jev] attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Parse the Jev response and map question IDs to probabilities.
 * Handles both array and object response formats.
 */
function parseResponse(data, questions) {
  const results = {};

  // Format 1: { answers: { [questionIndex]: { noul: { true: 0.9, false: 0.1 } } } }
  if (data.answers) {
    const answers = Array.isArray(data.answers) ? data.answers : Object.values(data.answers);
    questions.forEach((q, i) => {
      const answer = answers[i];
      if (answer && answer.noul) {
        results[q.id] = answer.noul.true ?? answer.noul.probability ?? 0;
      } else {
        results[q.id] = 0;
      }
    });
    return results;
  }

  // Format 2: { results: [{ id, probability }] }
  if (Array.isArray(data.results)) {
    data.results.forEach((r) => {
      results[r.id] = r.probability ?? 0;
    });
    return results;
  }

  // Format 3: direct map { [questionId]: probability }
  if (typeof data === 'object') {
    questions.forEach((q) => {
      results[q.id] = typeof data[q.id] === 'number' ? data[q.id] : 0;
    });
    return results;
  }

  return results;
}
