/*
 * Online-Modus: freiwilliges Konto, nur mit Passkey. Kein Name, keine E-Mail, kein Passwort, kein Profil.
 * Ohne Anmeldung läuft alles wie bisher lokal. Mit Anmeldung wird die Statistik mit dem Server
 * abgeglichen und ist auf allen Geräten dieselbe. Spielstände laufender Spiele bleiben auf dem Gerät.
 */
import { app, registerPage, save, render, toast, esc, fmt, topbar, confirmModal, goScreen } from './core.js';
import { store, saveStore, onStatsChange, forgetAccountData } from './stats.js';
import { supported, createPasskey, usePasskey, forgetPasskeys } from './webauthn.js';

const BADGE = '<span class="logo home">☁️</span>';

if (!app.account) app.account = { loggedIn: false, since: null };
const acc = () => app.account;

// Flüchtig: Erreichbarkeit des Servers und laufende Aktion
const net = { server: null, origin: null, busy: false, syncing: false, error: null };

// ---------- Server ----------

async function api(path, body, { method = body === undefined ? 'GET' : 'POST', keepalive = false } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    credentials: 'same-origin',
    keepalive,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Fehler ${res.status}`), { status: res.status, data });
  return data;
}

/** Ist der Server da und läuft die App unter der Adresse, für die Passkeys gelten? */
async function checkServer() {
  try {
    const c = await api('config');
    net.server = true;
    net.origin = c.origin;
  } catch {
    net.server = false;
  }
}

const sameOrigin = () => !net.origin || net.origin === location.origin;

function whyNot() {
  if (net.server === false) return 'Der Server ist gerade nicht erreichbar. Ohne Anmeldung funktioniert alles wie gewohnt.';
  if (!supported()) {
    return window.isSecureContext ? 'Dieser Browser unterstützt keine Passkeys.'
      : 'Passkeys funktionieren nur über eine sichere Verbindung (https).';
  }
  if (!sameOrigin()) return `Anmelden geht nur über <b>${esc(net.origin)}</b>.`;
  return null;
}

// ---------- Abgleich ----------

let timer = null;
let again = false;

function schedule(ms = 1500) {
  if (!acc().loggedIn) return;
  clearTimeout(timer);
  timer = setTimeout(() => sync(), ms);
}

const pending = () => Object.keys(store.dirty).length + store.removed.length;

/** Schickt Neues und Gelöschtes zum Server und übernimmt danach dessen Stand. */
export async function sync({ keepalive = false } = {}) {
  if (!acc().loggedIn) return;
  if (net.syncing) { again = true; return; }
  net.syncing = true;
  const sent = { ...store.dirty };
  const upsert = store.games.filter(g => sent[g.id]);
  const remove = [...store.removed];
  try {
    const body = { upsert, remove };
    const res = await api('sync', body, { keepalive: keepalive && JSON.stringify(body).length < 60000 });
    // Was während der Anfrage lokal dazukam oder geändert wurde, bleibt für den nächsten Abgleich.
    const stillDirty = store.games.filter(g => store.dirty[g.id] && store.dirty[g.id] !== sent[g.id]);
    const removedSince = store.removed.filter(id => !remove.includes(id));
    const map = new Map(res.games.map(g => [g.id, g]));
    stillDirty.forEach(g => map.set(g.id, g));
    removedSince.forEach(id => map.delete(id));
    store.games = [...map.values()];
    store.dirty = Object.fromEntries(stillDirty.map(g => [g.id, store.dirty[g.id]]));
    store.removed = removedSince;
    store.lastSync = Date.now();
    net.error = null;
    saveStore();
  } catch (e) {
    if (e.status === 401) loggedOut('Du bist nicht mehr angemeldet.');
    else net.error = e.status ? e.message : 'offline';
  } finally {
    net.syncing = false;
  }
  refresh();
  if (again) { again = false; schedule(0); }
}

/** Nur Seiten ohne Eingabefelder neu zeichnen, damit niemand beim Tippen gestört wird. */
function refresh() {
  if (['home', 'stats', 'account'].includes(app.screen)) render();
}

function loggedIn(since) {
  Object.assign(acc(), { loggedIn: true, since: since || Date.now() });
  save();
  sync();
}

function loggedOut(msg, opts) {
  clearTimeout(timer);
  Object.assign(acc(), { loggedIn: false, since: null });
  forgetAccountData(opts);
  save();
  refresh();
  if (msg) toast(msg, 3500);
}

// ---------- Passkey-Abläufe ----------

function passkeyError(e) {
  if (e && e.name === 'NotAllowedError') return 'Abgebrochen';
  if (e && e.name === 'InvalidStateError') return 'Auf diesem Gerät gibt es schon einen Passkey dafür';
  return (e && e.message) || 'Das hat nicht geklappt';
}

async function busy(fn) {
  if (net.busy) return;
  net.busy = true;
  render();
  try { await fn(); } catch (e) {
    // Passkey eines gelöschten Kontos: dem Passwort-Manager melden, damit er verschwindet.
    if (e.status === 404 && e.data && e.data.credentialId) forgetPasskeys(e.data.rpId, [e.data.credentialId]);
    toast(passkeyError(e), 3500);
  } finally {
    net.busy = false;
    render();
  }
}

const register = () => busy(async () => {
  const options = await api('register/options', {});
  const response = await createPasskey(options);
  await api('register/verify', { response });
  loggedIn();
  toast('Konto erstellt – du bist angemeldet', 3000);
});

const login = () => busy(async () => {
  const options = await api('login/options', {});
  const response = await usePasskey(options);
  await api('login/verify', { response });
  const me = await api('me').catch(() => ({}));
  loggedIn(me.since);
  toast('Angemeldet – die Statistik wird abgeglichen', 3000);
});

function logout() {
  const open = pending();
  confirmModal('Abmelden?',
    `Die Statistik bleibt in deinem Konto und ist nach dem nächsten Anmelden wieder da. Auf diesem Gerät wird sie ausgeblendet.${open ? ' Zuerst wird noch abgeglichen.' : ''}`,
    'Abmelden', () => busy(async () => {
      await sync();
      await api('logout', {}).catch(() => {});
      loggedOut('Abgemeldet');
    }), false);
}

function deleteAccount() {
  confirmModal('Konto löschen?',
    'Das Konto und die ganze Statistik darin werden endgültig gelöscht – auch auf diesem Gerät. Zur Bestätigung brauchst du deinen Passkey.',
    'Mit Passkey löschen', () => busy(async () => {
      const options = await api('account/delete/options', {});
      const response = await usePasskey(options);
      const res = await api('account/delete', { response });
      forgetPasskeys(res.rpId, res.credentialIds || []);
      loggedOut('Konto gelöscht', { all: true });
      goScreen('home');
    }));
}

// ---------- Seite ----------

function renderAccount() {
  const why = net.server === null ? null : whyNot();
  const dis = net.busy || why ? 'disabled' : '';
  if (!acc().loggedIn) {
    return `${topbar('Online-Modus', { back: 'home', badge: BADGE })}
    <div class="content">
      <div class="acct-hero">
        <div class="big">🔑</div>
        <b>Statistik sichern und überall dabei haben</b>
        <span>Mit einem Konto ist deine Statistik gesichert und auf allen deinen Geräten dieselbe.</span>
      </div>
      <ul class="checks">
        <li>Kein Name, keine E-Mail, kein Passwort – nur ein <b>Passkey</b> (Face ID, Fingerabdruck oder Geräte-PIN).</li>
        <li>Kein Profil: Niemand sieht dein Konto.</li>
        <li>Was schon auf diesem Gerät gespielt wurde, kommt mit ins Konto.</li>
        <li>Ohne Anmeldung funktioniert alles wie bisher, nur auf diesem Gerät.</li>
      </ul>
      ${why ? `<div class="banner">${why}</div>` : ''}
      <button class="btn primary" data-act="acct-register" ${dis}>${net.busy ? 'Einen Moment …' : 'Konto erstellen'}</button>
      <button class="btn" data-act="acct-login" ${dis}>Ich habe schon ein Konto – anmelden</button>
      <p class="hint">Auf einem anderen Gerät einfach «Anmelden» wählen. Der Passkey kommt über iCloud-Schlüsselbund
        bzw. Google-Passwortmanager mit oder lässt sich per QR-Code mit dem Handy bestätigen.</p>
    </div>`;
  }
  const open = pending();
  let status = store.lastSync ? `zuletzt ${new Date(store.lastSync).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}` : '–';
  if (net.syncing) status = 'läuft …';
  else if (net.error) status = net.error === 'offline' ? 'offline – später automatisch' : esc(net.error);
  else if (open) status = `${open} ausstehend`;
  return `${topbar('Online-Modus', { back: 'home', badge: BADGE })}
  <div class="content">
    <div class="acct-hero on">
      <div class="big">✓</div>
      <b>Angemeldet</b>
      <span>Deine Statistik wird automatisch mit deinem Konto abgeglichen.</span>
    </div>
    <div class="kv">
      <div><span>Konto seit</span><b>${acc().since ? new Date(acc().since).toLocaleDateString('de-CH') : '–'}</b></div>
      <div><span>Spiele in der Statistik</span><b>${fmt(store.games.length)}</b></div>
      <div><span>Abgleich</span><b>${status}</b></div>
    </div>
    <button class="btn" data-act="acct-sync" ${net.syncing ? 'disabled' : ''}>Jetzt abgleichen</button>
    <button class="btn ghost" data-act="acct-logout" ${net.busy ? 'disabled' : ''}>Abmelden</button>
    <button class="btn danger" data-act="acct-delete" ${net.busy || why ? 'disabled' : ''}>Konto löschen</button>
    ${why ? `<p class="hint">${why}</p>` : ''}
  </div>`;
}

function homeCard() {
  if (acc().loggedIn) {
    return `<button class="acct-card on" data-act="open-page" data-id="account">
      <span class="ic">☁️</span>
      <span class="gtext"><b>Angemeldet</b><small>Deine Statistik ist im Konto gesichert</small></span>
      <span class="chev">›</span>
    </button>`;
  }
  return `<button class="acct-card" data-act="open-page" data-id="account">
    <span class="ic">🔑</span>
    <span class="gtext"><b>Statistik sichern</b><small>Freiwillig, nur mit Passkey</small></span>
    <span class="pill">Anmelden</span>
  </button>`;
}

function act(a) {
  switch (a) {
    case 'acct-register': return register();
    case 'acct-login': return login();
    case 'acct-logout': return logout();
    case 'acct-delete': return deleteAccount();
    case 'acct-sync': return sync();
  }
}

registerPage({ id: 'account', render: renderAccount, homeCard, act });

// ---------- Start & Auslöser ----------

onStatsChange(() => schedule());
window.addEventListener('online', () => schedule(0));
document.addEventListener('visibilitychange', () => {
  if (!acc().loggedIn) return;
  if (document.visibilityState === 'visible') schedule(0);
  else if (pending()) sync({ keepalive: true });
});

(async () => {
  await checkServer();
  if (acc().loggedIn && net.server) {
    try {
      const me = await api('me');
      acc().since = me.since;
      sync();
    } catch (e) {
      if (e.status === 401) loggedOut('Du bist nicht mehr angemeldet.');
    }
  }
  if (app.screen === 'account') render();
})();
