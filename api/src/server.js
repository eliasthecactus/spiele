/*
 * Ein Server für alles: /api/* ist die Schnittstelle für Konto, Statistik und laufende Spiele,
 * alles andere sind die Dateien der App (Ordner frontend/).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { PORT, ORIGIN, RP_ID, FRONTEND_DIR, DATA_DIR, SECRET_MISSING } from './config.js';
import * as auth from './auth.js';
import * as db from './db.js';

const { HttpError } = auth;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_GAMES = 20000;
const MAX_GAME_SIZE = 20000;
const MAX_BATCH = 1000;
const MAX_LIVE = 20;
const MAX_LIVE_SIZE = 200000;

// ---------- Statistik ----------

const isId = id => typeof id === 'string' && /^[a-z0-9]{4,40}$/i.test(id);

function checkGame(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return false;
  if (!isId(g.id) || typeof g.game !== 'string' || !/^[a-z0-9-]{1,30}$/.test(g.game)) return false;
  if (!Number.isFinite(g.end) || !Array.isArray(g.players) || !g.players.length || g.players.length > 20) return false;
  return JSON.stringify(g).length <= MAX_GAME_SIZE;
}

/** Laufender Spielstand: { slot, at, state }, `at` = Zeitpunkt der letzten Änderung. */
function checkLive(l) {
  if (!l || typeof l !== 'object' || typeof l.slot !== 'string' || !/^[a-z0-9-]{1,30}$/.test(l.slot)) return false;
  if (!Number.isSafeInteger(l.at) || l.at <= 0) return false;
  if (!l.state || typeof l.state !== 'object' || Array.isArray(l.state)) return false;
  return JSON.stringify(l.state).length <= MAX_LIVE_SIZE;
}

/**
 * Abgleich: neue/geänderte Spiele speichern, gelöschte entfernen, laufende Spielstände übernehmen,
 * dann alles zurückgeben.
 */
function sync(ctx) {
  const userId = auth.requireUser(ctx);
  const upsert = ctx.body.upsert || [];
  const remove = ctx.body.remove || [];
  const live = ctx.body.live || [];
  if (!Array.isArray(upsert) || !Array.isArray(remove) || upsert.length > MAX_BATCH || remove.length > MAX_BATCH
    || !Array.isArray(live) || live.length > MAX_LIVE) {
    throw new HttpError(400, 'Ungültige Daten');
  }
  if (!upsert.every(checkGame) || !remove.every(isId) || !live.every(checkLive)) throw new HttpError(400, 'Ungültige Spieldaten');
  if (db.countGames(userId) + upsert.length > MAX_GAMES) throw new HttpError(413, 'Zu viele Spiele gespeichert');
  db.applySync(userId, upsert, remove, live);
  return { games: db.listGames(userId), live: db.listLive(userId) };
}

function me(ctx) {
  const userId = auth.requireUser(ctx);
  return { since: db.getUser(userId).created, games: db.countGames(userId) };
}

const routes = {
  'GET /api/health': () => ({ ok: true }),
  'GET /api/config': () => ({ origin: ORIGIN, rpId: RP_ID }),
  'GET /api/me': me,
  'POST /api/register/options': auth.registerOptions,
  'POST /api/register/verify': auth.registerVerify,
  'POST /api/login/options': auth.loginOptions,
  'POST /api/login/verify': auth.loginVerify,
  'POST /api/logout': auth.logout,
  'POST /api/account/delete/options': auth.deleteOptions,
  'POST /api/account/delete': auth.deleteAccount,
  'POST /api/sync': sync,
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Anfrage zu gross');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new HttpError(400, 'Ungültiges JSON'); }
}

async function handleApi(req, res, pathname) {
  const cookies = [];
  const send = (status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(cookies.length ? { 'Set-Cookie': cookies } : {}),
    });
    res.end(JSON.stringify(body));
  };
  try {
    const route = routes[`${req.method} ${pathname}`];
    if (!route) throw new HttpError(404, 'Nicht gefunden');
    if (req.method === 'POST') {
      // Schutz vor fremden Seiten: Änderungen nur von der eigenen Adresse und nur als JSON.
      if (req.headers.origin && req.headers.origin !== ORIGIN) throw new HttpError(403, 'Falsche Herkunft');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Nur JSON');
    }
    const ctx = {
      body: req.method === 'POST' ? await readBody(req) : {},
      cookies: auth.parseCookies(req.headers.cookie),
      setCookie: c => cookies.push(c),
    };
    send(200, await route(ctx));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    const status = e instanceof HttpError ? e.status : 500;
    send(status, { error: status === 500 ? 'Serverfehler' : e.message, ...(e.extra || {}) });
  }
}

// ---------- Dateien der App ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const ROOT = path.resolve(FRONTEND_DIR);
const cache = new Map(); // Pfad → { mtime, etag, raw, gz }

async function loadFile(file) {
  const st = await stat(file).catch(() => null);
  if (!st || !st.isFile()) return null;
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const raw = await readFile(file);
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const entry = {
    mtime: st.mtimeMs, type, raw,
    etag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
    gz: /^(text|application\/(json|manifest)|image\/svg)/.test(type) ? gzipSync(raw) : null,
  };
  cache.set(file, entry);
  return entry;
}

async function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = '/'; }
  let file = path.join(ROOT, path.normalize(rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) file = ROOT;
  // Unbekannte Pfade zeigen die App (wie bisher bei nginx mit try_files).
  const f = (await loadFile(file)) || (await loadFile(path.join(file, 'index.html'))) || (await loadFile(path.join(ROOT, 'index.html')));
  if (!f) { res.writeHead(404); return res.end(); }
  const headers = { 'Content-Type': f.type, 'Cache-Control': 'no-cache', ETag: f.etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); return res.end(); }
  const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gz ? f.gz : f.raw;
  res.writeHead(200, { ...headers, 'Content-Length': body.length, ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const isApi = pathname === '/api' || pathname.startsWith('/api/');
  (isApi ? handleApi : handleStatic)(req, res, pathname).catch(e => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(`Spiele läuft auf Port ${PORT} · Adresse ${ORIGIN} · Daten in ${DATA_DIR}`);
  if (SECRET_MISSING) console.warn('SECRET ist nicht gesetzt – nach einem Neustart sind alle abgemeldet.');
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
