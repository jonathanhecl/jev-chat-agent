/**
 * Lightweight HTTP client for the Jev-Style decision endpoint.
 * Uses native fetch — no heavy dependencies.
 *
 * API format (POST /v1/systemone):
 *   Request:  { "state": string, "questions": { id: { "type": "noul", "instructions": "..." } } }
 *   Response: { "answers": { id: { "type": "noul", "noul": 0.45 } } }
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the Jev endpoint with a state and multiple noul (yes/no) questions.
 *
 * @param {string} endpoint - Full URL of the /v1/systemone endpoint
 * @param {string} state - The context/state text
 * @param {Object} questions - Map of questionId -> { instructions: string }
 * @returns {Object} Map of questionId -> probability (0.0 - 1.0)
 */
export async function decideMany(endpoint, state, questions) {
  const payload = {
    state,
    questions: Object.entries(questions).reduce((acc, [id, q]) => {
      acc[id] = { type: 'noul', instructions: q.instructions };
      return acc;
    }, {}),
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
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${response.statusText} — ${body}`);
      }

      const data = await response.json();
      return parseResponse(data, Object.keys(questions));
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
 * Expected format: { answers: { [id]: { type: "noul", noul: 0.45 } } }
 */
function parseResponse(data, questionIds) {
  const results = {};

  if (data.answers && typeof data.answers === 'object') {
    for (const id of questionIds) {
      const answer = data.answers[id];
      if (answer && typeof answer.noul === 'number') {
        results[id] = answer.noul;
      } else {
        results[id] = 0;
      }
    }
    return results;
  }

  // Fallback: direct map { [id]: probability }
  if (typeof data === 'object') {
    for (const id of questionIds) {
      results[id] = typeof data[id] === 'number' ? data[id] : 0;
    }
    return results;
  }

  return results;
}
