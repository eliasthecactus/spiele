// Ende-zu-Ende-Test der Schnittstelle mit einem nachgebauten Passkey (Software-Authenticator).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const PORT = 3900 + Math.floor(Math.random() * 90);
const ORIGIN = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'spiele-test-'));
let server;

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    env: { ...process.env, PORT, APP_URL: ORIGIN, SECRET: 'test-secret', DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(resolve => server.stdout.once('data', resolve));
});

after(() => {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

// ---------- Hilfen ----------

const b64 = buf => Buffer.from(buf).toString('base64url');
const sha = buf => createHash('sha256').update(buf).digest();

/** Ein Browser mit eigenem Cookie-Speicher. */
function client() {
  const jar = {};
  return Object.assign(call, { jar });
  async function call(p, body, { method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    const res = await fetch(ORIGIN + p, {
      method,
      headers: {
        ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: ORIGIN } : {}),
        Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (v) jar[k] = v; else delete jar[k];
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
}

/** Passkey-Gerät: erzeugt Schlüssel und signiert Challenges wie ein echter Authenticator. */
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  const rpHash = sha('localhost');
  let counter = 0;
  let userHandle = null;
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  return {
    id: b64(credId),
    create(options) {
      userHandle = options.user.id;
      const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), u32(0), Buffer.alloc(16), len, credId, Buffer.from(cose)]);
      const attestationObject = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return {
        id: b64(credId), rawId: b64(credId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64(clientData('webauthn.create', options.challenge)), attestationObject: b64(attestationObject), transports: ['internal'] },
      };
    },
    get(options) {
      const cd = clientData('webauthn.get', options.challenge);
      const authData = Buffer.concat([rpHash, Buffer.from([0x05]), u32(++counter)]);
      const signature = sign('sha256', Buffer.concat([authData, sha(cd)]), privateKey);
      return {
        id: b64(credId), rawId: b64(credId), type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: b64(cd), authenticatorData: b64(authData), signature: b64(signature), userHandle },
      };
    },
  };
}

async function register(call, key) {
  const opt = await call('/api/register/options', {});
  assert.equal(opt.status, 200);
  assert.equal(opt.data.authenticatorSelection.residentKey, 'required');
  return call('/api/register/verify', { response: key.create(opt.data) });
}

async function login(call, key) {
  const opt = await call('/api/login/options', {});
  assert.equal(opt.status, 200);
  assert.deepEqual(opt.data.allowCredentials || [], []);
  return call('/api/login/verify', { response: key.get(opt.data) });
}

const gameRec = (id, winner = 'Anna') => ({
  id, game: 'uno', start: 1, end: Date.now(), rounds: 3,
  players: [{ name: winner, place: 1, score: 40 }, { name: 'Ben', place: 2, score: 310 }],
});

// ---------- Tests ----------

test('App-Dateien und Fallback auf index.html', async () => {
  const call = client();
  const home = await call('/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(home.data, /<main id="app">/);
  const js = await call('/js/core.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await call('/js/core.js', undefined, { headers: { 'If-None-Match': js.headers.get('etag') } })).status, 304);
  assert.match((await call('/irgendwo/hin')).data, /<main id="app">/);
  assert.match((await call('/..%2f..%2fapi%2fpackage.json')).data, /<main id="app">/);
  assert.equal((await call('/api/gibts-nicht')).status, 404);
});

test('Konto: registrieren, abgleichen, abmelden, anmelden, löschen', async () => {
  const call = client();
  const key = authenticator();
  assert.deepEqual((await call('/api/config')).data, { origin: ORIGIN, rpId: 'localhost' });
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/sync', {})).status, 401);

  const reg = await register(call, key);
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal((await call('/api/me')).data.games, 0);

  // Abgleich: hochladen, ändern, löschen
  let s = await call('/api/sync', { upsert: [gameRec('game0001'), gameRec('game0002')] });
  assert.equal(s.data.games.length, 2);
  s = await call('/api/sync', { upsert: [gameRec('game0001', 'Chris')], remove: ['game0002'] });
  assert.deepEqual(s.data.games.map(g => g.players[0].name), ['Chris']);
  assert.equal((await call('/api/sync', { upsert: [{ id: 'x' }] })).status, 400);
  assert.equal((await call('/api/sync', { upsert: [gameRec('bad id!')] })).status, 400);

  // Fremde Seiten dürfen nichts ändern
  assert.equal((await call('/api/sync', {}, { headers: { Origin: 'https://evil.example' } })).status, 403);

  // Dieselbe Antwort samt Challenge-Cookie kann nicht zweimal verwendet werden
  const opt = await call('/api/login/options', {});
  const answer = key.get(opt.data);
  const challenge = call.jar.spiele_ch;
  assert.equal((await call('/api/login/verify', { response: answer })).status, 200);
  call.jar.spiele_ch = challenge;
  assert.equal((await call('/api/login/verify', { response: answer })).status, 400);

  assert.equal((await call('/api/logout', {})).status, 200);
  assert.equal((await call('/api/me')).status, 401);

  const li = await login(call, key);
  assert.equal(li.status, 200, JSON.stringify(li.data));
  assert.equal((await call('/api/me')).data.games, 1);

  // Ein zweites Konto sieht nichts vom ersten
  const other = client();
  assert.equal((await register(other, authenticator())).status, 200);
  assert.equal((await other('/api/sync', {})).data.games.length, 0);

  // Löschen braucht den Passkey des eigenen Kontos
  const delOpt = await call('/api/account/delete/options', {});
  assert.deepEqual(delOpt.data.allowCredentials.map(c => c.id), [key.id]);
  const del = await call('/api/account/delete', { response: key.get(delOpt.data) });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.deepEqual(del.data.credentialIds, [key.id]);
  assert.equal((await call('/api/me')).status, 401);

  // Danach gibt es zu diesem Passkey kein Konto mehr
  const gone = await login(call, key);
  assert.equal(gone.status, 404);
  assert.equal(gone.data.credentialId, key.id);
  assert.equal((await other('/api/me')).status, 200);
});

test('Fremder Passkey kann ein Konto nicht löschen', async () => {
  const a = client(); const keyA = authenticator();
  const b = client(); const keyB = authenticator();
  await register(a, keyA);
  await register(b, keyB);
  const opt = await a('/api/account/delete/options', {});
  const res = await a('/api/account/delete', { response: keyB.get(opt.data) });
  assert.equal(res.status, 403);
  assert.equal((await a('/api/me')).status, 200);
});
