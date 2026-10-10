import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./bot.js', import.meta.url), 'utf8');
const block = source.slice(
  source.indexOf('// ANSI color codes'),
  source.indexOf('async function sendChatMessage')
);

const GREEN = '\x1b[32m';
const WHITE = '\x1b[37m';
const COLORS = {
  insult: '\x1b[31m',
  spam: '\x1b[38;5;208m',
  toxicity: '\x1b[35m',
  links: '\x1b[36m',
  attention: '\x1b[33m',
};
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const ORDER = Object.keys(COLORS);

function runLog(decisions, elapsedMs, thresholds = Object.fromEntries(ORDER.map((c) => [c, 0.7]))) {
  const lines = [];
  const sandbox = { console: { log: (line) => lines.push(line) }, config: { thresholds } };
  const result = { decisions };
  const args = `'alice', 'hello world', ${JSON.stringify(result)}${elapsedMs === undefined ? '' : `, ${elapsedMs}`}`;
  vm.runInNewContext(`${block}\nlogResult(${args});`, sandbox);
  return lines[0];
}

function dominantDecisions(dominant, dominantProb, flagged) {
  const decisions = {};
  for (const c of ORDER) {
    decisions[c] = { probability: c === dominant ? dominantProb : 0.1, flagged };
  }
  return decisions;
}

test('bracket color follows the dominant category with nothing flagged', () => {
  for (const cat of ORDER) {
    const line = runLog(dominantDecisions(cat, 0.4, false), 12);
    assert.ok(line.includes(`${COLORS[cat]}[`), `${cat} should color the bracket`);
    assert.ok(!line.includes(BOLD), 'no bold when nothing is flagged');
  }
});

test('bracket color stays dominant when everything is flagged', () => {
  for (const cat of ORDER) {
    const line = runLog(dominantDecisions(cat, 0.4, true), 12);
    assert.ok(line.includes(`${COLORS[cat]}[`));
    for (const c of ORDER) {
      const pct = c === cat ? '40.0' : '10.0';
      assert.ok(
        line.includes(`${BOLD}${c} ${pct}%${RESET}${COLORS[cat]}`),
        `${c} part should restore the dominant color`
      );
    }
  }
});

test('dominant spam stays orange even with attention flagged, suffix stays yellow', () => {
  const decisions = dominantDecisions('spam', 0.6, false);
  decisions.attention = { probability: 0.5, flagged: true };
  const line = runLog(decisions, 12);
  assert.ok(line.includes(`${COLORS.spam}[`));
  assert.ok(line.includes(`${BOLD}attention 50.0%${RESET}${COLORS.spam}`));
  assert.ok(line.includes(` \x1b[33mℹ attention 50%${RESET}`));
  assert.ok(line.endsWith(`]${RESET} \x1b[33mℹ attention 50%${RESET} ${DIM}[12ms]${RESET}`));
});

test('equal probabilities keep the later category', () => {
  const decisions = dominantDecisions('insult', 0.5, false);
  for (const c of ORDER) decisions[c].probability = 0.5;
  const line = runLog(decisions);
  assert.ok(line.includes(`${COLORS.attention}[`));
});

test('username, message, percentages and timing are preserved', () => {
  const line = runLog(dominantDecisions('links', 0.4, false), 12);
  assert.ok(line.startsWith('[alice] hello world → '));
  for (const c of ORDER) {
    const pct = c === 'links' ? '40.0' : '10.0';
    assert.ok(line.includes(`${c} ${pct}%`));
  }
  assert.ok(line.endsWith(`${DIM}[12ms]${RESET}`));
});

test('unknown dominant category falls back to green', () => {
  const line = runLog({ mystery: { probability: 0.9, flagged: false } });
  assert.ok(line.includes(`${GREEN}[`));
});

const MIXED_THRESHOLDS = { insult: 0.8, spam: 0.8, toxicity: 0.8, links: 1.1, attention: 0.6 };

test('all probabilities below half their own thresholds render white', () => {
  const decisions = {
    insult: { probability: 0.39, flagged: false },
    spam: { probability: 0.39, flagged: false },
    toxicity: { probability: 0.39, flagged: false },
    links: { probability: 0.54, flagged: false },
    attention: { probability: 0.29, flagged: false },
  };
  const line = runLog(decisions, 12, MIXED_THRESHOLDS);
  assert.ok(line.includes(`${WHITE}[`));
  assert.ok(line.startsWith('[alice] hello world → '));
  assert.ok(line.includes('links 54.0%'));
  assert.ok(line.endsWith(`${DIM}[12ms]${RESET}`));
  assert.ok(!line.includes(COLORS.links));
});

test('exactly half threshold keeps the category color; below goes white', () => {
  for (const cat of ORDER) {
    const half = MIXED_THRESHOLDS[cat] / 2;
    for (const [prob, expected] of [
      [half, COLORS[cat]],
      [half - 0.001, WHITE],
      [half + 0.001, COLORS[cat]],
    ]) {
      const decisions = Object.fromEntries(
        ORDER.map((c) => [c, { probability: c === cat ? prob : 0, flagged: false }])
      );
      const line = runLog(decisions, undefined, MIXED_THRESHOLDS);
      assert.ok(line.includes(`${expected}[`), `${cat} at ${prob} should be ${expected === WHITE ? 'white' : 'colored'}`);
    }
  }
});

test('raw probability just below half prints rounded percent but stays white', () => {
  const decisions = dominantDecisions('insult', 0.39999, false);
  const line = runLog(decisions, undefined, MIXED_THRESHOLDS);
  assert.ok(line.includes(`${WHITE}[`));
  assert.ok(line.includes('insult 40.0%'));
});

test('white requires every category below half, not just the dominant one', () => {
  const decisions = {
    insult: { probability: 0, flagged: false },
    spam: { probability: 0, flagged: false },
    toxicity: { probability: 0, flagged: false },
    links: { probability: 0.5, flagged: false },
    attention: { probability: 0.31, flagged: false },
  };
  const line = runLog(decisions, undefined, MIXED_THRESHOLDS);
  assert.ok(line.includes(`${COLORS.links}[`));
  assert.ok(!line.includes(`${WHITE}[`));
});

test('zero threshold keeps color on probability equality', () => {
  const decisions = Object.fromEntries(ORDER.map((c) => [c, { probability: 0, flagged: false }]));
  const thresholds = { ...MIXED_THRESHOLDS, attention: 0 };
  const line = runLog(decisions, undefined, thresholds);
  assert.ok(line.includes(`${COLORS.attention}[`));
  assert.ok(!line.includes(`${WHITE}[`));
});
