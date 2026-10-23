/*
 * Anmeldung nur mit Passkey: kein Name, keine E-Mail, kein Passwort.
 *
 * - Registrieren legt ein Konto mit einer zufälligen ID an, an der ein Passkey hängt.
 * - Anmelden ohne Benutzernamen (discoverable credential): der Passkey sagt, zu welchem Konto er gehört.
 * - Löschen verlangt nochmals den Passkey.
 *
 * Sitzung und laufende Challenge stehen in signierten Cookies, der Server merkt sich dafür nichts.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { ORIGIN, RP_ID, RP_NAME, SECRET, SECURE } from './config.js';
import * as db from './db.js';

const SESSION = 'spiele_sid';
const CHALLENGE = 'spiele_ch';
const SESSION_DAYS = 365;
const CHALLENGE_MIN = 5;

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------- Signierte Tokens & Cookies ----------

const hmac = s => createHmac('sha256', SECRET).update(s).digest('base64url');

function seal(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body)}`;
}

function unseal(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(hmac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/api; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${SECURE ? '; Secure' : ''}`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Konto-ID der aktuellen Sitzung oder null. */
export function sessionUser(ctx) {
  const s = unseal(ctx.cookies[SESSION]);
  return s && s.k === 'sid' && db.getUser(s.u) ? s.u : null;
}

export function requireUser(ctx) {
  const u = sessionUser(ctx);
  if (!u) throw new HttpError(401, 'Nicht angemeldet');
  return u;
}

function startSession(ctx, userId) {
  ctx.setCookie(cookie(SESSION, seal({ k: 'sid', u: userId, exp: Date.now() + SESSION_DAYS * 864e5 }), SESSION_DAYS * 86400));
}

function setChallenge(ctx, data) {
  ctx.setCookie(cookie(CHALLENGE, seal({ ...data, exp: Date.now() + CHALLENGE_MIN * 6e4 }), CHALLENGE_MIN * 60));
}

// Verbrauchte Challenges, damit eine abgefangene Antwort nicht nochmals verwendet werden kann.
const used = new Map();

/** Liest die Challenge des passenden Schritts und verbraucht sie. */
function takeChallenge(ctx, kind) {
  const c = unseal(ctx.cookies[CHALLENGE]);
  ctx.setCookie(cookie(CHALLENGE, '', 0));
  if (!c || c.k !== kind || used.has(c.c)) throw new HttpError(400, 'Anfrage abgelaufen, bitte nochmals versuchen');
  const now = Date.now();
  for (const [k, exp] of used) if (exp < now) used.delete(k);
  used.set(c.c, c.exp);
  return c;
}

export function logout(ctx) {
  ctx.setCookie(cookie(SESSION, '', 0));
  return { ok: true };
}

// ---------- Passkey-Abläufe ----------

const expect = { expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false };

function credentialOf(body) {
  const id = body && body.response && body.response.id;
  if (typeof id !== 'string' || !id) throw new HttpError(400, 'Ungültige Antwort');
  return id;
}

export async function registerOptions(ctx) {
  const userId = randomBytes(16).toString('base64url');
  // Ohne Benutzernamen braucht der Passkey trotzdem eine Bezeichnung; das Datum hilft, mehrere auseinanderzuhalten.
  const label = `${RP_NAME} (${new Date().toLocaleDateString('de-CH')})`;
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(userId),
    userName: label,
    userDisplayName: label,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  setChallenge(ctx, { k: 'reg', c: options.challenge, u: userId });
  return options;
}

export async function registerVerify(ctx) {
  const ch = takeChallenge(ctx, 'reg');
  let result;
  try {
    result = await verifyRegistrationResponse({ response: ctx.body.response, expectedChallenge: ch.c, ...expect });
  } catch (e) {
    throw new HttpError(400, `Passkey konnte nicht geprüft werden: ${e.message}`);
  }
  if (!result.verified) throw new HttpError(400, 'Passkey konnte nicht geprüft werden');
  const cred = result.registrationInfo.credential;
  if (db.getCredential(cred.id)) throw new HttpError(409, 'Dieser Passkey ist schon registriert');
  db.createUser(ch.u, cred);
  startSession(ctx, ch.u);
  return { ok: true };
}

export async function loginOptions(ctx) {
  const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' });
  setChallenge(ctx, { k: 'login', c: options.challenge });
  return options;
}

/** Prüft eine Passkey-Antwort gegen die gespeicherten Schlüssel und gibt den Passkey zurück. */
async function verifyPasskey(ctx, kind) {
  const ch = takeChallenge(ctx, kind);
  const credId = credentialOf(ctx.body);
  const cred = db.getCredential(credId);
  // Gibt es den Passkey nicht (mehr), kann der Browser ihn aus dem Passwort-Manager entfernen.
  if (!cred) throw new HttpError(404, 'Zu diesem Passkey gibt es kein Konto', { credentialId: credId, rpId: RP_ID });
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: ctx.body.response, expectedChallenge: ch.c, credential: cred, ...expect,
    });
  } catch (e) {
    throw new HttpError(400, `Passkey konnte nicht geprüft werden: ${e.message}`);
  }
  if (!result.verified) throw new HttpError(400, 'Passkey konnte nicht geprüft werden');
  db.useCredential(cred.id, result.authenticationInfo.newCounter);
  return cred;
}

export async function loginVerify(ctx) {
  const cred = await verifyPasskey(ctx, 'login');
  startSession(ctx, cred.userId);
  return { ok: true };
}

export async function deleteOptions(ctx) {
  const userId = requireUser(ctx);
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    allowCredentials: db.credentialsOf(userId).map(c => ({ id: c.id, transports: c.transports })),
  });
  setChallenge(ctx, { k: 'delete', c: options.challenge });
  return options;
}

export async function deleteAccount(ctx) {
  const userId = requireUser(ctx);
  const cred = await verifyPasskey(ctx, 'delete');
  if (cred.userId !== userId) throw new HttpError(403, 'Dieser Passkey gehört zu einem anderen Konto');
  const credentialIds = db.credentialsOf(userId).map(c => c.id);
  db.deleteUser(userId);
  logout(ctx);
  return { ok: true, rpId: RP_ID, credentialIds };
}
