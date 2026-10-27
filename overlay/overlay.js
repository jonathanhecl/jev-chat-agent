const stage = document.getElementById('stage');
const statusEl = document.getElementById('status');
const params = new URLSearchParams(window.location.search);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function number(name, fallback) {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function flag(name, fallback) {
  if (!params.has(name)) return fallback;
  return !['0', 'false', 'off', 'no'].includes((params.get(name) || '').toLowerCase());
}

const SETTINGS = {
  fontSize: clamp(number('size', 40), 12, 160),
  speed: clamp(number('speed', 220), 20, 1200), // pixels per second
  lanes: Math.round(clamp(number('lanes', 12), 1, 40)),
  laneGap: clamp(number('gap', 64), 0, 600),
  top: clamp(number('top', 0), 0, 4000),
  maxChars: Math.round(clamp(number('chars', 140), 10, 500)),
  showNames: flag('names', true),
  demo: flag('demo', false),
  debug: flag('debug', false),
  demoMin: clamp(number('demoMin', 400), 100, 60000),
  demoMax: clamp(number('demoMax', 1700), 200, 60000),
};

const LANE_HEIGHT = Math.ceil(SETTINGS.fontSize * 1.7);
const SCORPION_TEXT = 'Scorpio';
const DEMO_SCORPION_PHRASE = 'esta es la frase de canjeo';
const SCORPION_HOLD_MS = 10000;
const laneFreeAt = new Array(SETTINGS.lanes).fill(0);
const pending = [];
let flushTimer = null;

let scorpionActive = false;
let scorpionEndTimer = null;
let scorpionFadeTimer = null;
let scorpionSafetyTimer = null;

document.documentElement.style.setProperty('--font-size', `${SETTINGS.fontSize}px`);
if (SETTINGS.debug) document.body.classList.add('debug');

function userColor(username) {
  let hash = 0;
  for (const char of username) hash = (hash * 31 + char.codePointAt(0)) % 360000;
  return `hsl(${hash % 360} 95% 76%)`;
}

function place(entry, lane, now) {
  const element = document.createElement('div');
  element.className = entry.attention ? 'danmaku attention' : 'danmaku';
  if (scorpionActive) element.classList.add('scorpion');
  element.style.top = `${SETTINGS.top + lane * LANE_HEIGHT}px`;

  if (SETTINGS.showNames && entry.username) {
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = entry.username;
    name.style.setProperty('--name-color', userColor(entry.username));
    const colon = document.createElement('span');
    colon.className = 'colon';
    colon.textContent = ':';
    element.append(name, colon);
  }

  const body = document.createElement('span');
  body.className = 'text';
  body.textContent = entry.text;
  element.append(body);

  const startX = stage.clientWidth + 24;
  element.style.transform = `translateX(${startX}px)`;
  stage.append(element);

  const width = Math.ceil(element.getBoundingClientRect().width);
  const endX = -width - 24;
  const duration = ((startX - endX) / SETTINGS.speed) * 1000;

  const animation = element.animate(
    [
      { transform: `translateX(${startX}px)` },
      { transform: `translateX(${endX}px)` },
    ],
    { duration, easing: 'linear', fill: 'forwards' }
  );
  animation.onfinish = () => element.remove();

  laneFreeAt[lane] = now + ((width + SETTINGS.laneGap) / SETTINGS.speed) * 1000;
}

function flush() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const now = performance.now();
  while (pending.length > 0) {
    const lane = laneFreeAt.findIndex((freeAt) => freeAt <= now);
    if (lane === -1) break;
    place(pending.shift(), lane, now);
  }

  if (pending.length > 0) {
    const wait = Math.max(16, Math.min(...laneFreeAt) - performance.now() + 4);
    flushTimer = setTimeout(flush, wait);
  }
}

/**
 * Queue one chat line. Message text is always rendered with textContent,
 * so Twitch content cannot inject markup into the widget.
 */
function push(username, text, attention = false) {  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return;

  const clipped = clean.length > SETTINGS.maxChars
    ? `${clean.slice(0, SETTINGS.maxChars - 1).trimEnd()}…`
    : clean;

  pending.push({
    username: String(username || '').trim().slice(0, 40),
    text: clipped,
    attention: attention === true,
  });
  if (pending.length > 250) pending.shift();
  flush();
}

/**
 * "Scorpio" reward: paint chat lines red and drop a fiery label with the
 * redemption phrase in the middle of the screen. New lines stay red until
 * the label disappears after 10 seconds; then every line returns to normal.
 */
function triggerScorpion(phrase = '') {
  scorpionActive = true;

  for (const element of document.querySelectorAll('.danmaku')) {
    element.classList.add('scorpion');
  }

  if (scorpionEndTimer) clearTimeout(scorpionEndTimer);
  if (scorpionFadeTimer) clearTimeout(scorpionFadeTimer);
  if (scorpionSafetyTimer) clearTimeout(scorpionSafetyTimer);
  document.getElementById('scorpion')?.remove();

  const layer = document.createElement('div');
  layer.id = 'scorpion';

  const label = document.createElement('span');
  label.className = 'scorpion-text';
  label.dataset.text = SCORPION_TEXT;
  label.textContent = SCORPION_TEXT;
  layer.append(label);

  const cleanPhrase = String(phrase ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (cleanPhrase) {
    const phraseElement = document.createElement('span');
    phraseElement.className = 'scorpion-phrase';
    phraseElement.textContent = cleanPhrase;
    layer.append(phraseElement);
  }

  document.body.append(layer);

  layer.animate(
    [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0.55)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.05)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
    ],
    { duration: 420, easing: 'ease-out', fill: 'forwards' }
  );

  scorpionFadeTimer = window.setTimeout(() => {
    if (!layer.isConnected) return;
    layer.animate(
      [
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.15)' },
      ],
      { duration: 400, easing: 'ease-in', fill: 'forwards' }
    );
  }, SCORPION_HOLD_MS - 400);

  scorpionEndTimer = window.setTimeout(() => {
    layer.remove();
    scorpionActive = false;
    for (const element of document.querySelectorAll('.danmaku')) {
      element.classList.remove('scorpion');
    }
  }, SCORPION_HOLD_MS);

  scorpionSafetyTimer = window.setTimeout(() => layer.remove(), SCORPION_HOLD_MS + 500);
}

function connect() {
  const source = new EventSource('./events');

  source.addEventListener('open', () => {
    document.body.classList.add('connected');
    statusEl.textContent = 'overlay · connected';
  });

  source.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload?.type && payload.type !== 'message') return;
    push(payload?.username, payload?.text, payload?.attention === true);
  });

  source.addEventListener('redemption', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload?.type !== 'redemption') return;
    triggerScorpion(payload.phrase);
  });

  source.addEventListener('error', () => {
    document.body.classList.remove('connected');
    statusEl.textContent = 'overlay · reconnecting…';
  });
}

const DEMO_MESSAGES = [
  { username: 'kitsune_92', text: 'こんにちは！初見です', attention: true },
  { username: 'sakura_mochi', text: 'このゲームうまいね' },
  { username: 'hide', text: '¿de dónde sos?', attention: true },
  { username: 'lin_wei', text: '主播好厉害' },
  { username: 'tanghulu', text: '这是什么游戏？', attention: true },
  { username: 'pixelpanda', text: 'that dodge was clean' },
  { username: 'mika_zzz', text: 'ganbatte! がんばれー' },
  { username: 'el_tano', text: 'buena jugada 👏' },
  { username: 'neko_night', text: 'first time here, love the vibes', attention: true },
  { username: 'chen_88', text: '来了来了' },
  { username: 'sofia.g', text: 'hola desde argentina 🇦🇷', attention: true },
  { username: 'drift_king', text: 'GG WP' },
  { username: 'yuki', text: 'そのスキル強すぎる' },
  { username: 'bubbletea', text: 'chat is so friendly today' },
  { username: 'raul', text: '¿jugás ranked después?', attention: true },
  { username: 'ming', text: '哈哈哈哈太强了' },
  { username: 'asuka__', text: '明日も配信ある？', attention: true },
  { username: 'n0va', text: 'the music in this level is so good' },
];

function startDemo() {
  let index = Math.floor(Math.random() * DEMO_MESSAGES.length);

  const next = () => {
    const item = DEMO_MESSAGES[index++ % DEMO_MESSAGES.length];
    push(item.username, item.text, item.attention === true);

    if (Math.random() < 0.25) {
      const burst = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < burst; i += 1) {
        setTimeout(() => {
          const extra = DEMO_MESSAGES[index++ % DEMO_MESSAGES.length];
          push(extra.username, extra.text, extra.attention === true);
        }, 80 + i * 140);
      }
    }

    const delay = SETTINGS.demoMin + Math.random() * (SETTINGS.demoMax - SETTINGS.demoMin);
    setTimeout(next, delay);
  };

  setTimeout(next, 250);
}

if (SETTINGS.demo) {
  document.body.classList.add('demo', 'connected');
  statusEl.textContent = 'overlay · demo mode';
  startDemo();
  window.setTimeout(() => triggerScorpion(DEMO_SCORPION_PHRASE), 4500);
  window.setInterval(() => triggerScorpion(DEMO_SCORPION_PHRASE), 22000);
} else {
  connect();
}

if (flag('scorpion', false)) {
  window.setTimeout(() => triggerScorpion(DEMO_SCORPION_PHRASE), 800);
}

window.overlay = {
  push,
  settings: SETTINGS,
};
