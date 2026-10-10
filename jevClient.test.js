import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { decideMany } from './jevClient.js';
import { classifyMessage } from './classifier.js';

const MODEL = 'laya:322m-multilingual-mlx-fp16';

function stubFetch(t, impl) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return impl(url, options);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

test('decideMany sends the selected model, state and questions, returns noul probabilities', async (t) => {
  const questions = {
    insult: { instructions: 'Is this message an insult?' },
    spam: { instructions: 'Is this message spam?' },
  };
  const calls = stubFetch(t, async () => ({
    ok: true,
    json: async () => ({
      answers: {
        insult: { type: 'noul', noul: 0.8 },
        spam: { type: 'noul', noul: 0.2 },
      },
    }),
  }));

  const result = await decideMany('http://example.test/v1/systemone', 'some state', questions, MODEL);

  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, 'http://example.test/v1/systemone');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Type'], 'application/json');

  const body = JSON.parse(options.body);
  assert.equal(body.model, MODEL);
  assert.equal(body.state, 'some state');
  assert.deepEqual(Object.keys(body.questions), ['insult', 'spam']);
  for (const [id, q] of Object.entries(questions)) {
    assert.equal(body.questions[id].type, 'noul');
    assert.equal(body.questions[id].instructions, q.instructions);
  }

  assert.deepEqual(result, { insult: 0.8, spam: 0.2 });
});

test('classifyMessage forwards the supplied model and flags by threshold', async (t) => {
  const calls = stubFetch(t, async () => ({
    ok: true,
    json: async () => ({
      answers: {
        insult: { type: 'noul', noul: 0.8 },
        spam: { type: 'noul', noul: 0.2 },
        toxicity: { type: 'noul', noul: 0.8 },
        links: { type: 'noul', noul: 0.2 },
        attention: { type: 'noul', noul: 0.8 },
      },
    }),
  }));

  const thresholds = {
    insult: 0.7,
    spam: 0.7,
    toxicity: 0.7,
    links: 0.7,
    attention: 0.7,
  };

  const result = await classifyMessage(
    'http://example.test/v1/systemone',
    'hello world',
    { channel: 'chan', username: 'user' },
    thresholds,
    [],
    MODEL
  );

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, MODEL);

  assert.deepEqual(result.probabilities, {
    insult: 0.8,
    spam: 0.2,
    toxicity: 0.8,
    links: 0.2,
    attention: 0.8,
  });
  assert.equal(result.decisions.insult.flagged, true);
  assert.equal(result.decisions.spam.flagged, false);
  assert.equal(result.decisions.toxicity.flagged, true);
  assert.equal(result.decisions.links.flagged, false);
  assert.equal(result.decisions.attention.flagged, true);
});

function runConfig(env, selector = 'm.config.jev.model') {
  const childEnv = { PATH: process.env.PATH, ...env };
  return spawnSync(
    process.execPath,
    ['-e', `import("./config.js").then((m) => console.log(${selector})).catch((e) => { console.error(e.message); process.exit(1); })`],
    {
      cwd: new URL('.', import.meta.url).pathname,
      env: childEnv,
      encoding: 'utf8',
    }
  );
}

const BASE_ENV = {
  DOTENV_CONFIG_PATH: '/nonexistent/test.env',
  TWITCH_CHANNEL: 'chan',
  TWITCH_USERNAME: 'user',
  TWITCH_TOKEN: 'oauth:token',
};

test('config fails when JEV_MODEL is missing', () => {
  const res = runConfig(BASE_ENV);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Missing required env var: JEV_MODEL/);
});

test('config fails when JEV_MODEL is empty', () => {
  const res = runConfig({ ...BASE_ENV, JEV_MODEL: '' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Missing required env var: JEV_MODEL/);
});

test('config.jev.model equals the provided JEV_MODEL', () => {
  const res = runConfig({ ...BASE_ENV, JEV_MODEL: MODEL });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), MODEL);
});

const ENDPOINT_ENV = { ...BASE_ENV, JEV_MODEL: MODEL };
const ENDPOINT_SELECTOR = 'm.config.jev.endpoint';

function endpoint(env) {
  const res = runConfig({ ...ENDPOINT_ENV, ...env }, ENDPOINT_SELECTOR);
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trim();
}

test('config.jev.endpoint normalization', () => {
  assert.equal(endpoint({}), 'http://localhost:11434/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: '' }), 'http://localhost:11434/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'mac-mini.local' }), 'http://mac-mini.local:11434/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'mac-mini.local:12345' }), 'http://mac-mini.local:12345/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'http://mac-mini.local' }), 'http://mac-mini.local:11434/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'http://mac-mini.local/' }), 'http://mac-mini.local:11434/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'https://mac-mini.local' }), 'https://mac-mini.local:11434/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'http://mac-mini.local:80' }), 'http://mac-mini.local/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'https://mac-mini.local:443' }), 'https://mac-mini.local/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'http://localhost:8765/v1/systemone' }), 'http://localhost:8765/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: 'http://localhost:8765/v1/systemone/' }), 'http://localhost:8765/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: '127.0.0.1' }), 'http://127.0.0.1:11434/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: '[::1]' }), 'http://[::1]:11434/v1/systemone');
  assert.equal(endpoint({ JEV_ENDPOINT: '[::1]:12345' }), 'http://[::1]:12345/v1/systemone');
});

test('config.jev.endpoint rejects invalid values', () => {
  for (const bad of [
    'ftp://host',
    'http://u:p@host',
    'host?x=1',
    'host#f',
    'host/wrong',
    'host:70000',
  ]) {
    const res = runConfig({ ...ENDPOINT_ENV, JEV_ENDPOINT: bad }, ENDPOINT_SELECTOR);
    assert.equal(res.status, 1, `expected failure for ${bad}`);
    assert.match(res.stderr, /Invalid JEV_ENDPOINT/);
  }
});
