/*
 * Gemeinsamer Kern aller Spiele: Speicher, UI-Bausteine, Modale, Startseite,
 * Anleitungen und die Event-Verteilung. Alles lokal im Browser (localStorage).
 *
 * Jedes Spiel ist ein Modul, das sich mit registerGame() anmeldet und seinen
 * eigenen Spielstand unter app.games[id] hat. Weitere Seiten (Statistik, Konto)
 * melden sich mit registerPage() an.
 */

const STORE_KEY = 'spiele.v1';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

// ---------- Persistenz ----------

export function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
export function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus o.ä. */ }
}

// Die frühere reine UNO-App speicherte unter eigenen Schlüsseln. Diese Daten werden bewusst nicht übernommen.
try { localStorage.removeItem('uno300.state.v1'); localStorage.removeItem('uno300.lastPlayers.v1'); } catch { /* ignore */ }

function loadApp() {
  const a = storageGet(STORE_KEY);
  if (a && a.v === 1 && a.games && typeof a.games === 'object' && Array.isArray(a.roster)) return a;
  return {
    v: 1,
    screen: 'home',          // home | rules | <Spiel-ID>
    rulesFor: null,
    rulesBack: 'home',
    games: {},               // Spielstand pro Spiel
    roster: [],              // zuletzt verwendete Spieler, gilt für alle Spiele
  };
}

export const app = loadApp();

const saveHooks = [];

/** `fn` läuft bei jedem Speichern, z.B. um fertige Spiele in die Statistik zu übernehmen. */
export function onSave(fn) {
  saveHooks.push(fn);
}

export function save() {
  saveHooks.forEach(fn => fn());
  storageSet(STORE_KEY, app);
}

// Flüchtiger UI-Zustand (Modale), wird nicht gespeichert.
export const ui = { modal: null };

// ---------- Spiele-Register ----------

export const GAMES = {};
const ORDER = [];

export function registerGame(mod) {
  GAMES[mod.id] = mod;
  ORDER.push(mod.id);
}

/** Seiten neben den Spielen: { id, render(), act(act, el), modal?(m), homeCard?() } */
export const PAGES = {};

export function registerPage(page) {
  PAGES[page.id] = page;
}

export function game(id) {
  if (!app.games[id]) app.games[id] = GAMES[id].fresh(null);
  return app.games[id];
}

export function resetGame(id) {
  app.games[id] = GAMES[id].fresh(app.games[id]);
}

function current() {
  const mod = GAMES[app.screen];
  return mod ? { mod, s: game(mod.id) } : null;
}

// ---------- Hilfsfunktionen ----------

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmt = n => Number(n).toLocaleString('de-CH');

/** Nächster Spieler nach `id` in Sitzordnung, der `ok` erfüllt (notfalls `id` selbst). */
export function nextAfter(list, id, ok = () => true) {
  const i = list.findIndex(p => p.id === id);
  for (let k = 1; k <= list.length; k++) {
    const p = list[(i + k + list.length) % list.length];
    if (ok(p.id)) return p.id;
  }
  return null;
}

export function movePlayer(list, id, dir) {
  const i = list.findIndex(p => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

export function parseExpr(s) {
  if (!s) return null;
  const parts = String(s).split('+').filter(Boolean);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + parseInt(b, 10), 0);
}

/** Spieler für ein neues Spiel: die zuletzt verwendeten, sonst zwei leere. */
export function rosterPlayers() {
  const r = app.roster.length ? app.roster : [{ id: uid(), name: '' }, { id: uid(), name: '' }];
  return r.map(p => ({ id: p.id || uid(), name: p.name || '' }));
}

export function rememberPlayers(players) {
  app.roster = players.map(p => ({ id: p.id, name: p.name }));
}

/** Prüft die Namen und trimmt sie. Gibt eine Fehlermeldung zurück oder null. */
export function checkNames(players) {
  const names = players.map(p => (p.name || '').trim());
  if (players.length < MIN_PLAYERS) return `Mindestens ${MIN_PLAYERS} Spieler`;
  if (names.some(n => !n)) return 'Bitte alle Namen eintragen';
  if (new Set(names.map(n => n.toLowerCase())).size !== names.length) return 'Namen müssen unterschiedlich sein';
  players.forEach((p, i) => { p.name = names[i]; });
  return null;
}

export function render() {
  const root = document.getElementById('app');
  if (app.screen === 'rules' && !GAMES[app.rulesFor]) app.screen = 'home';
  if (app.screen !== 'rules' && app.screen !== 'home' && !GAMES[app.screen] && !PAGES[app.screen]) app.screen = 'home';
  const c = current();
  const page = PAGES[app.screen];
  root.className = `t-${c ? c.mod.id : app.screen === 'rules' ? app.rulesFor : app.screen}`;
  const html = app.screen === 'rules' ? renderRules(GAMES[app.rulesFor]) : c ? c.mod.render(c.s) : page ? page.render() : renderHome();
  const scroll = window.scrollY;
  root.innerHTML = html + renderModal(c);
  // Platz für den unten angedockten Ziffernblock schaffen
  const dock = root.querySelector('.keypad.dock');
  const content = root.querySelector('.content');
  if (dock && content) content.style.paddingBottom = `${dock.offsetHeight + 16}px`;
  window.scrollTo(0, scroll);
  document.body.style.overflow = root.querySelector('.backdrop') ? 'hidden' : '';
}

/** Ansicht innerhalb eines Spiels wechseln (z.B. Verlauf). */
export function show(s, view) {
  s.view = view;
  save();
  render();
  window.scrollTo(0, 0);
}

// ---------- Toast ----------

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Bausteine ----------

export function topbar(title, { back, backLabel = '‹', menu, badge = '' } = {}) {
  return `<header class="topbar">
    ${back ? `<button class="icon-btn" data-act="${back}" aria-label="Zurück">${backLabel}</button>` : ''}
    <h1>${badge}<span>${esc(title)}</span></h1>
    ${menu ? '<button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>' : ''}
  </header>`;
}

export function tableSvg(list, markId, emoji) {
  const n = list.length;
  if (n < 1) return '';
  const W = 300, H = 230, cx = W / 2, cy = H / 2, rx = 112, ry = 82;
  let seats = '';
  list.forEach((p, i) => {
    // Start unten, dann gegen den Uhrzeigersinn (von oben betrachtet).
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = cx + rx * Math.cos(a);
    const y = cy - ry * Math.sin(a);
    const on = p.id === markId;
    const label = (p.name || `Spieler ${i + 1}`).slice(0, 10);
    seats += `<g><circle class="seat ${on ? 'on' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15"></circle>
      <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-weight="700">${on ? emoji : i + 1}</text>
      <text x="${x.toFixed(1)}" y="${(y + (Math.sin(a) > 0.2 ? -21 : 30)).toFixed(1)}" text-anchor="middle">${esc(label)}</text></g>`;
  });
  // Pfeil gegen den Uhrzeigersinn in der Tischmitte
  const r = 26;
  const arc = `M ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx} ${cy + r}`;
  return `<svg class="table-vis" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sitzordnung am Tisch">
    <ellipse class="felt" cx="${cx}" cy="${cy}" rx="${rx - 34}" ry="${ry - 30}"></ellipse>
    <path class="arrow" d="${arc}"></path>
    <path class="arrowhead" d="M ${cx - 7} ${cy + r - 6} L ${cx} ${cy + r} L ${cx - 7} ${cy + r + 6} Z"></path>
    ${seats}
  </svg>`;
}

function playerRows(list, markId, { removable, emoji, label }) {
  return `<div class="plist">${list.map((p, i) => `
    <div class="prow">
      <span class="num">${i + 1}</span>
      <input type="text" value="${esc(p.name)}" placeholder="Name Spieler ${i + 1}" maxlength="20"
        data-name-id="${p.id}" autocomplete="off" autocapitalize="words" enterkeyhint="next">
      <button class="mini" data-act="move-up" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">▲</button>
      <button class="mini" data-act="move-down" data-id="${p.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="nach unten">▼</button>
      <button class="mini mix ${p.id === markId ? 'on' : ''}" data-act="set-mark" data-id="${p.id}" aria-label="${label}" title="${label}">${emoji}</button>
      ${removable ? `<button class="mini" data-act="remove" data-id="${p.id}" ${list.length <= MIN_PLAYERS ? 'disabled' : ''} aria-label="entfernen">✕</button>` : ''}
    </div>`).join('')}
  </div>`;
}

/** Spieler-Erfassung vor dem Spiel, für alle Spiele gleich. `s.firstId` = wer beginnt/mischt. */
export function setupScreen(mod, s, { hint, fields = '' }) {
  const list = s.players;
  const { emoji, first } = mod.mark;
  return `${topbar(mod.title, { back: 'home', badge: mod.badge })}
  <div class="content">
    <div class="section-title">Spieler & Sitzordnung</div>
    <p class="hint">${hint}</p>
    ${playerRows(list, s.firstId, { removable: true, emoji, label: first })}
    <button class="btn ghost" data-act="add-player" ${list.length >= MAX_PLAYERS ? 'disabled' : ''}>＋ Spieler hinzufügen (${list.length}/${MAX_PLAYERS})</button>
    ${tableSvg(list, s.firstId, emoji)}
    ${fields}
    <button class="btn primary" data-act="start">Spiel starten</button>
    <button class="btn ghost small" data-act="rules">📖 Anleitung</button>
  </div>`;
}

/**
 * Ziffernblock. `rows` ist eine Liste von Zeilen mit je 4 Tasten [Beschriftung, Taste, Klasse];
 * `null` lässt eine Zelle leer.
 */
export function keypad(rows, readout = '') {
  return `${readout}<div class="grid">${rows.flat().map(k => !k
    ? '<span></span>'
    : `<button class="${k[2] || ''}" data-key="${k[1] || k[0]}">${k[0]}</button>`).join('')}</div>`;
}

const PLAIN_ROWS = [
  [['7'], ['8'], ['9'], ['⌫', 'back', 'k-op']],
  [['4'], ['5'], ['6'], ['C', 'clear', 'k-op']],
  [['1'], ['2'], ['3'], null],
  [null, ['0'], null, ['OK', 'go', 'k-save']],
];

/** Taste auf einen Eingabe-Ausdruck wie "120+20+50" anwenden. `add:N` hängt +N an. */
export function applyKey(expr, key, { plus = false, maxLen = 4 } = {}) {
  expr = expr || '';
  const last = expr.split('+').pop();
  if (key === 'back') return expr.slice(0, -1);
  if (key === 'clear') return '';
  if (key === 'plus') return !plus || !expr || expr.endsWith('+') ? expr : expr + '+';
  if (key.startsWith('add:')) {
    const v = key.slice(4);
    return !expr || expr.endsWith('+') ? expr + v : expr + '+' + v;
  }
  if (!/^\d+$/.test(key)) return expr;
  const next = (last + key).replace(/^0+(?=\d)/, ''); // keine führenden Nullen
  if (next.length > maxLen) return expr;
  return expr.slice(0, expr.length - last.length) + next;
}

// ---------- Modale ----------

export function confirmModal(title, text, ok, onOk, danger = true) {
  ui.modal = { type: 'confirm', title, text, ok, onOk, danger };
  render();
}

/** Zahleneingabe. `extra` = zusätzliche Knöpfe [{ label, cls, fn }]. */
export function numberModal(opts) {
  ui.modal = { type: 'number', value: '', maxLen: 5, extra: [], ...opts };
  render();
}

function renderModal(c) {
  let m = ui.modal;
  // Spiele können Modale aus dem Spielstand ableiten (z.B. UNO-Spielende), die auch nach einem Neuladen erscheinen.
  if (!m && c && c.mod.autoModal) m = c.mod.autoModal(c.s);
  if (!m) return '';
  let inner = '';
  switch (m.type) {
    case 'confirm':
      inner = `<h2>${esc(m.title)}</h2><p>${esc(m.text)}</p>
        <div class="btn-row"><button class="btn ghost" data-act="modal-close">Abbrechen</button>
        <button class="btn ${m.danger ? 'primary' : 'green'}" data-act="modal-ok">${esc(m.ok)}</button></div>`;
      break;
    case 'number': {
      const val = m.value === '' ? '<span style="color:var(--muted)">–</span>' : esc(m.value);
      inner = `<h2>${esc(m.title)}</h2>${m.text ? `<p>${m.text}</p>` : ''}
        <div class="bignum">${val}<span class="caret"></span>${m.sub ? `<small>${m.sub}</small>` : ''}</div>
        <div class="keypad inline" data-pad="number">${keypad(PLAIN_ROWS)}</div>
        ${m.extra.map((x, i) => `<button class="btn ${x.cls || 'ghost'}" data-act="modal-extra" data-i="${i}">${esc(x.label)}</button>`).join('')}
        <button class="btn ghost" data-act="modal-close">Abbrechen</button>`;
      break;
    }
    case 'menu':
      inner = `<h2>Menü</h2><div class="menu-list">
        ${c.mod.menu(c.s).map(it => `<button class="btn ${it.cls || ''}" data-act="${it.act}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`).join('')}
        <button class="btn" data-act="rules">📖 Anleitung</button>
        <button class="btn" data-act="home">Zur Spielauswahl</button>
        <button class="btn ghost" data-act="modal-close">Schliessen</button></div>`;
      break;
    case 'order': {
      const { emoji, now, verb } = c.mod.mark;
      inner = `<h2>Reihenfolge & Namen</h2>
        <p>Sitzordnung gegen den Uhrzeigersinn. Mit ${emoji} festlegen, wer <b>jetzt</b> ${verb}.</p>
        ${playerRows(m.players, m.next, { removable: false, emoji, label: now })}
        ${tableSvg(m.players, m.next, emoji)}
        <div class="btn-row"><button class="btn ghost" data-act="modal-close">Abbrechen</button>
        <button class="btn green" data-act="order-save">Übernehmen</button></div>`;
      break;
    }
    default: {
      const page = PAGES[app.screen];
      inner = c && c.mod.modal ? c.mod.modal(c.s, m) : page && page.modal ? page.modal(m) : '';
    }
  }
  return `<div class="backdrop" data-act="${m.locked ? 'noop' : 'backdrop'}"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
}

function openOrder(c) {
  ui.modal = {
    type: 'order',
    players: c.s.players.map(p => ({ ...p })),
    next: c.mod.orderCurrent(c.s),
    manual: false,
  };
  render();
}

function saveOrder(c) {
  const m = ui.modal;
  const players = m.players.map(p => ({ ...p }));
  const err = checkNames(players) || c.mod.orderSave(c.s, players, m.next);
  if (err) return toast(err);
  ui.modal = null;
  rememberPlayers(c.s.players);
  save();
  render();
  toast('Reihenfolge gespeichert');
}

// ---------- Startseite & Anleitungen ----------

function renderHome() {
  return `${topbar('Spiele', { badge: '<span class="logo home">🎲</span>' })}
  <div class="content">
    <p class="hint">Punkte zählen ohne Zettel.</p>
    ${ORDER.map(id => {
      const mod = GAMES[id];
      const st = app.games[id] ? mod.status(app.games[id]) : null;
      return `<div class="gcard t-${id}">
        <button class="gmain" data-act="open-game" data-id="${id}">
          ${mod.badge}
          <span class="gtext"><b>${esc(mod.title)}</b><small>${esc(mod.tagline)}</small>
            ${st ? `<span class="gstatus">${esc(st)}</span>` : ''}</span>
        </button>
        <button class="grules" data-act="rules" data-id="${id}" aria-label="Anleitung ${esc(mod.title)}">
          <span class="ic">📖</span>Regeln</button>
      </div>`;
    }).join('')}
    ${Object.values(PAGES).map(p => (p.homeCard ? p.homeCard() : '')).join('')}
  </div>`;
}

function renderRules(mod) {
  const fromGame = app.rulesBack === mod.id;
  return `${topbar(mod.title, { back: 'rules-back', backLabel: '‹ Zurück', badge: mod.badge })}
  <div class="content">
    <article class="rules">${mod.rules}</article>
    ${fromGame
      ? '<button class="btn primary" data-act="rules-back">Zurück zum Spiel</button>'
      : `<button class="btn primary" data-act="open-game" data-id="${mod.id}">${esc(mod.title)} öffnen</button>`}
  </div>`;
}

export function goScreen(screen) {
  ui.modal = null;
  app.screen = screen;
  save();
  render();
  window.scrollTo(0, 0);
}

// ---------- Events ----------

document.addEventListener('click', e => {
  const c = current();
  const keyBtn = e.target.closest('[data-key]');
  if (keyBtn) return onKey(c, keyBtn.dataset.key, keyBtn.closest('[data-pad]').dataset.pad);

  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const { act, id } = el.dataset;
  if (act === 'backdrop' && e.target !== el) return; // Klick im Sheet, nicht daneben

  const m = ui.modal;
  const inOrder = m && m.type === 'order';

  switch (act) {
    case 'noop': return;
    case 'backdrop':
    case 'modal-close': ui.modal = null; return render();
    case 'modal-ok': { const fn = m.onOk; ui.modal = null; return fn(); }
    case 'modal-extra': { const x = m.extra[Number(el.dataset.i)]; ui.modal = null; return x.fn(); }

    // Navigation
    case 'home': return goScreen('home');
    case 'open-game':
    case 'open-page': return goScreen(id);
    case 'rules':
      app.rulesFor = id || (c && c.mod.id);
      app.rulesBack = c ? c.mod.id : 'home';
      return goScreen('rules');
    case 'rules-back': return goScreen(app.rulesBack || 'home');
    case 'menu': ui.modal = { type: 'menu' }; return render();
    case 'order': ui.modal = null; return openOrder(c);
    case 'order-save': return saveOrder(c);
  }

  if (PAGES[app.screen]) return PAGES[app.screen].act(act, el);
  if (!c) return;
  const s = c.s;

  // Spieler-Erfassung und Reihenfolge (für alle Spiele gleich)
  switch (act) {
    case 'add-player':
      if (s.players.length >= MAX_PLAYERS) return;
      s.players.push({ id: uid(), name: '' });
      save(); render();
      { const inputs = document.querySelectorAll('[data-name-id]'); inputs[inputs.length - 1].focus(); }
      return;
    case 'remove':
      if (s.players.length <= MIN_PLAYERS) return;
      s.players = s.players.filter(p => p.id !== id);
      if (s.firstId === id) s.firstId = s.players[0].id;
      save(); return render();
    case 'move-up':
    case 'move-down': {
      const dir = act === 'move-up' ? -1 : 1;
      if (inOrder) {
        movePlayer(m.players, id, dir);
        if (!m.manual) m.next = c.mod.orderNext(s, m.players) || m.next;
      } else { movePlayer(s.players, id, dir); save(); }
      return render();
    }
    case 'set-mark':
      if (inOrder) { m.next = id; m.manual = true; } else { s.firstId = id; save(); }
      return render();
  }

  c.mod.act(s, act, el);
});

document.addEventListener('input', e => {
  const id = e.target.dataset && e.target.dataset.nameId;
  const c = current();
  if (!id || !c) return;
  const inOrder = ui.modal && ui.modal.type === 'order';
  const list = inOrder ? ui.modal.players : c.s.players;
  const p = list.find(x => x.id === id);
  if (p) p.name = e.target.value;
  if (!inOrder) save();
  // Tischgrafik live nachführen, ohne den Fokus zu verlieren
  const svg = document.querySelector('.table-vis');
  if (svg) svg.outerHTML = tableSvg(list, inOrder ? ui.modal.next : c.s.firstId, c.mod.mark.emoji);
});

document.addEventListener('keydown', e => {
  // Enter in einem Namensfeld springt ins nächste Feld
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.nameId) {
    e.preventDefault();
    const inputs = [...document.querySelectorAll('[data-name-id]')];
    const i = inputs.indexOf(e.target);
    if (inputs[i + 1]) inputs[i + 1].focus(); else e.target.blur();
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  // Hardware-Tastatur (Desktop) für den Ziffernblock
  const pad = document.querySelector(ui.modal ? '[data-pad="number"]' : '.keypad.dock[data-pad]');
  if (!pad) return;
  const map = { Backspace: 'back', Enter: 'go', Escape: 'clear', '+': 'plus' };
  const key = /^\d$/.test(e.key) ? e.key : map[e.key];
  if (key) { e.preventDefault(); onKey(current(), key, pad.dataset.pad); }
});

function onKey(c, key, pad) {
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* ignore */ } }
  if (pad === 'number') {
    const m = ui.modal;
    if (!m || m.type !== 'number') return;
    if (key === 'go') return m.onOk(m.value);
    m.value = applyKey(m.value, key, { maxLen: m.maxLen });
    return render();
  }
  if (c) c.mod.key(c.s, key, pad);
}

// Zustand auch beim Verlassen/Wegwischen sicher speichern
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

export function start() {
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}
