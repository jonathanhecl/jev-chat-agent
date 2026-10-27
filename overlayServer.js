import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'overlay');

// Categories that keep a message out of the overlay (attention is informational).
export const NEGATIVE_CATEGORIES = ['insult', 'spam', 'toxicity', 'links'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const HEARTBEAT_MS = 15000;

/**
 * A message belongs in the overlay when no negative category is flagged.
 */
export function shouldOverlay(decisions = {}) {
  return NEGATIVE_CATEGORIES.every((category) => decisions[category]?.flagged !== true);
}

/**
 * Collapse whitespace and cut the text so a single danmaku line stays readable.
 */
export function truncateText(text, maxChars = 140) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Public URL to open, rewriting wildcard bind addresses to something clickable.
 */
export function formatOverlayUrl(host, port) {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const hostPart = shown.includes(':') ? `[${shown}]` : shown;
  return `http://${hostPart}:${port}/`;
}

/**
 * Build the payload consumed by the overlay. Attention-only messages carry a
 * flag so the widget can render them with a blue glow.
 */
export function createOverlayMessage(username, text, decisions, maxChars = 140) {
  return {
    type: 'message',
    username,
    text: truncateText(text, maxChars),
    attention: decisions?.attention?.flagged === true,
    ts: Date.now(),
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    send(res, 400, 'Bad Request');
    return;
  }

  const relative = decoded === '/' ? '/index.html' : decoded;
  const filePath = path.resolve(PUBLIC_DIR, `.${relative}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    send(res, 403, 'Forbidden');
    return;
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    send(res, 404, 'Not Found');
    return;
  }

  if (info.isDirectory()) {
    send(res, 404, 'Not Found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/**
 * HTTP server for the OBS overlay: static files plus a Server-Sent Events stream
 * that carries every displayable chat message.
 */
export function createOverlayServer({ host = '127.0.0.1', port = 3000 } = {}) {
  const clients = new Set();
  let heartbeat = null;

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      send(res, 400, 'Bad Request');
      return;
    }

    if (url.pathname === '/events') {
      openEventStream(req, res);
      return;
    }

    if (url.pathname === '/health') {
      const body = JSON.stringify({ ok: true, clients: clients.size });
      send(res, 200, body, { 'Content-Type': 'application/json; charset=utf-8' });
      return;
    }

    serveStatic(req, res, url.pathname).catch(() => {
      if (!res.headersSent) send(res, 500, 'Internal Server Error');
      else res.destroy();
    });
  });

  function openEventStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    clients.add(res);
    const drop = () => clients.delete(res);
    req.on('close', drop);
    req.on('error', drop);
    res.on('close', drop);
  }

  function broadcast(event) {
    const name = event?.type || 'message';
    const payload = `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
    return clients.size;
  }

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        heartbeat = setInterval(() => {
          for (const res of clients) {
            try {
              res.write(': ping\n\n');
            } catch {
              clients.delete(res);
            }
          }
        }, HEARTBEAT_MS);
        heartbeat.unref();
        resolve();
      });
    });
  }

  async function close() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    for (const res of clients) {
      try {
        res.end();
      } catch {
        // already closed
      }
      res.destroy();
    }
    clients.clear();
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return {
    server,
    broadcast,
    listen,
    close,
    get port() {
      const address = server.address();
      return typeof address === 'object' && address ? address.port : port;
    },
    get clients() {
      return clients.size;
    },
  };
}

/**
 * Create and start the overlay server in one step.
 */
export async function startOverlayServer(options) {
  const overlay = createOverlayServer(options);
  await overlay.listen();
  return overlay;
}
