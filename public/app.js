'use strict';

/*
 * UNO Punktezähler – alles lokal im Browser (localStorage), kein Backend.
 *
 * Reihenfolge der Spielerliste = Sitzordnung gegen den Uhrzeigersinn.
 * Damit ist der nächste Mischer immer der nächste Eintrag nach dem letzten Mischer.
 */

const STORE_KEY = 'uno300.state.v1';
const LAST_KEY = 'uno300.lastPlayers.v1';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const DEFAULT_TARGET = 300;

// ---------- Persistenz ----------

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privater Modus o.ä. */ }
}

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

function freshState() {
  const last = storageGet(LAST_KEY);
  const players = last && Array.isArray(last.players) && last.players.length
    ? last.players.map(p => ({ id: p.id || uid(), name: p.name || '' }))
    : [{ id: uid(), name: '' }, { id: uid(), name: '' }];
  const first = last && players.some(p => p.id === last.firstShufflerId) ? last.firstShufflerId : players[0].id;
  return {
    v: 1,
    phase: 'setup',          // setup | game | over
    view: 'game',            // game | round | history
    players,
    target: (last && last.target) || DEFAULT_TARGET,
    firstShufflerId: first,
    nextShufflerId: null,
    rounds: [],              // { shufflerId, outId, points: {id: n}, ts }
    corrections: [],         // { playerId, delta, afterRound, ts }
    draft: null,             // { outId, values: {id: 'expr'}, activeId }
    endDecision: null,       // null | 'ausspielen'
    startedAt: null,
  };
}

let state = storageGet(STORE_KEY);
if (!state || state.v !== 1 || !Array.isArray(state.players)) state = freshState();

function save() {
  storageSet(STORE_KEY, state);
}

function saveLast() {
  storageSet(LAST_KEY, {
    players: state.players.map(p => ({ id: p.id, name: p.name })),
    target: state.target,
    firstShufflerId: state.nextShufflerId || state.firstShufflerId,
  });
}

// Flüchtiger UI-Zustand (Modale), wird nicht gespeichert.
const ui = { modal: null };

// ---------- Ableitungen ----------

const byId = id => state.players.find(p => p.id === id);
const nameOf = id => (byId(id) || { name: '?' }).name;

function nextAfter(list, id) {
  const i = list.findIndex(p => p.id === id);
  if (i < 0) return list[0] && list[0].id;
  return list[(i + 1) % list.length].id;
}

function totals(uptoRound = Infinity) {
  const t = {};
  state.players.forEach(p => { t[p.id] = 0; });
  state.rounds.forEach((r, i) => {
    if (i >= uptoRound) return;
    for (const id in r.points) t[id] = (t[id] || 0) + r.points[id];
  });
  state.corrections.forEach(c => {
    if (c.afterRound <= uptoRound) t[c.playerId] = (t[c.playerId] || 0) + c.delta;
  });
  return t;
}

function standings() {
  const t = totals();
  const order = state.players.map((p, i) => ({ ...p, seat: i, pts: t[p.id] }));
  order.sort((a, b) => a.pts - b.pts || a.seat - b.seat);
  return order;
}

function anyOver() {
  const t = totals();
  return state.players.some(p => t[p.id] > state.target);
}

/** Wenn niemand mehr über dem Ziel ist, wird ein Spielende/Ausspielen zurückgesetzt. */
function reconcileEnd() {
  if (!anyOver()) {
    state.endDecision = null;
    if (state.phase === 'over') { state.phase = 'game'; state.view = 'game'; }
  }
}

function parseExpr(s) {
  if (!s) return null;
  const parts = String(s).split('+').filter(Boolean);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + parseInt(b, 10), 0);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Toast ----------

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Bausteine ----------

function topbar(title, { back, menu } = {}) {
  return `<header class="topbar">
    ${back ? `<button class="icon-btn" data-act="${back}" aria-label="Zurück">‹ Zurück</button>` : ''}
    <h1><span class="logo">UNO</span><span>${esc(title)}</span></h1>
    ${menu ? `<button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>` : ''}
  </header>`;
}

function tableSvg(list, shufflerId) {
  const n = list.length;
  if (n < 1) return '';
  const W = 300, H = 230, cx = W / 2, cy = H / 2, rx = 112, ry = 82;
  let seats = '';
  list.forEach((p, i) => {
    // Start unten, dann gegen den Uhrzeigersinn (von oben betrachtet).
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = cx + rx * Math.cos(a);
    const y = cy - ry * Math.sin(a);
    const on = p.id === shufflerId;
    const label = (p.name || `Spieler ${i + 1}`).slice(0, 10);
    seats += `<g><circle class="seat ${on ? 'on' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15"></circle>
      <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-weight="700">${on ? '🃏' : i + 1}</text>
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

function playerRows(list, shufflerId, { removable, mixLabel = 'mischt' }) {
  return `<div class="plist">${list.map((p, i) => `
    <div class="prow">
      <span class="num">${i + 1}</span>
      <input type="text" value="${esc(p.name)}" placeholder="Name Spieler ${i + 1}" maxlength="20"
        data-name-id="${p.id}" autocomplete="off" autocapitalize="words" enterkeyhint="next">
      <button class="mini" data-act="move-up" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">▲</button>
      <button class="mini" data-act="move-down" data-id="${p.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="nach unten">▼</button>
      <button class="mini mix ${p.id === shufflerId ? 'on' : ''}" data-act="set-mix" data-id="${p.id}" aria-label="${mixLabel}" title="${mixLabel}">🃏</button>
      ${removable ? `<button class="mini" data-act="remove" data-id="${p.id}" ${list.length <= MIN_PLAYERS ? 'disabled' : ''} aria-label="entfernen">✕</button>` : ''}
    </div>`).join('')}
  </div>`;
}

function keypad({ mode, readout, goLabel, goClass }) {
  const cards = mode === 'cards';
  const keys = cards ? [
    ['7'], ['8'], ['9'], ['⌫', 'back', 'k-op'],
    ['4'], ['5'], ['6'], ['+20<small>Aktion</small>', 'p20', 'k-act'],
    ['1'], ['2'], ['3'], ['+50<small>Joker</small>', 'p50', 'k-act'],
    ['+', 'plus', 'k-op'], ['0'], ['C', 'clear', 'k-op'], [goLabel, 'go', goClass],
  ] : [
    ['7'], ['8'], ['9'], ['⌫', 'back', 'k-op'],
    ['4'], ['5'], ['6'], ['C', 'clear', 'k-op'],
    ['1'], ['2'], ['3'], ['', 'noop', 'k-op'],
    ['', 'noop', 'k-op'], ['0'], ['', 'noop', 'k-op'], [goLabel, 'go', goClass],
  ];
  return `${readout || ''}<div class="grid">${keys.map(([label, key, cls]) =>
    key === 'noop'
      ? '<span></span>'
      : `<button class="${cls || ''}" data-key="${key || label}">${label}</button>`).join('')}</div>`;
}

function applyKey(expr, key, { cards }) {
  expr = expr || '';
  const last = expr.split('+').pop();
  switch (key) {
    case 'back': return expr.slice(0, -1);
    case 'clear': return '';
    case 'plus':
      if (!cards || !expr || expr.endsWith('+')) return expr;
      return expr + '+';
    case 'p20':
    case 'p50': {
      const v = key === 'p20' ? '20' : '50';
      if (!expr || expr.endsWith('+')) return expr + v;
      return expr + '+' + v;
    }
    default:
      if (!/^\d$/.test(key)) return expr;
      if (last.length >= 4) return expr;
      if (last === '0') return expr.slice(0, -1) + key; // keine führenden Nullen
      return expr + key;
  }
}

// ---------- Screens ----------

function renderSetup() {
  const list = state.players;
  return `${topbar('Neues Spiel')}
  <div class="content">
    <div class="section-title">Spieler & Sitzordnung</div>
    <p class="hint">Reihenfolge <b>gegen den Uhrzeigersinn</b> eintragen – so wandert das Mischen. Mit 🃏 festlegen, wer die erste Runde mischt.</p>
    ${playerRows(list, state.firstShufflerId, { removable: true, mixLabel: 'mischt zuerst' })}
    <button class="btn ghost" data-act="add-player" ${list.length >= MAX_PLAYERS ? 'disabled' : ''}>＋ Spieler hinzufügen (${list.length}/${MAX_PLAYERS})</button>
    ${tableSvg(list, state.firstShufflerId)}
    <button class="field" data-act="edit-target" style="border:0;color:inherit;font:inherit;width:100%;text-align:left">
      <span>Ziel (Spielende über …)</span><span class="val">${state.target} ›</span>
    </button>
    <button class="btn primary" data-act="start">Spiel starten</button>
  </div>`;
}

function dealerCard() {
  const n = state.rounds.length + 1;
  return `<div class="dealer">
    <div class="cards">🃏</div>
    <div><div class="lbl">Mischt jetzt</div><div class="name">${esc(nameOf(state.nextShufflerId))}</div></div>
    <div class="meta">Runde<b>${n}</b></div>
  </div>`;
}

function renderStandingsList(clickable) {
  const t = state.target;
  return `<ol class="standings">${standings().map((p, i, arr) => {
    const rank = i > 0 && arr[i - 1].pts === p.pts ? '' : i + 1;
    const pct = Math.min(100, (p.pts / t) * 100);
    const cls = p.pts > t ? 'over' : pct >= 80 ? 'warn' : '';
    const rest = t - p.pts;
    const sub = p.pts > t ? `${-rest} über dem Ziel` : `noch ${rest} bis ${t}`;
    const tag = p.id === state.nextShufflerId && state.phase === 'game' ? '<span class="tag">🃏 mischt</span>' : '';
    return `<li class="${p.pts > t ? 'over-target' : ''}"><button ${clickable ? `data-act="correct" data-id="${p.id}"` : 'disabled'}>
      <span class="rank">${rank}</span>
      <span class="pname">${esc(p.name)}${tag}</span>
      <span class="pts">${p.pts}</span>
      <span class="bar"><i class="${cls}" style="width:${pct}%"></i></span>
      <span class="sub">${sub}</span>
    </button></li>`;
  }).join('')}</ol>`;
}

function renderGame() {
  const hasDraft = !!state.draft;
  const banner = state.endDecision === 'ausspielen'
    ? `<div class="banner">Das Ziel ist überschritten – <b>es wird ausgespielt</b>. Spiel beenden, sobald ihr fertig seid.</div>` : '';
  return `${topbar(`Ziel ${state.target}`, { menu: true })}
  <div class="content">
    ${dealerCard()}
    ${banner}
    <button class="btn primary" data-act="open-round">${hasDraft ? '✎ Angefangene Runde fortsetzen' : '＋ Runde erfassen'}</button>
    <div class="section-title">Stand</div>
    ${renderStandingsList(true)}
    <p class="hint">Tippe auf einen Spieler, um seinen Punktestand zu korrigieren.</p>
    <div class="btn-row">
      <button class="btn small" data-act="history">Verlauf</button>
      <button class="btn small" data-act="order">Reihenfolge</button>
      <button class="btn small" data-act="undo" ${state.rounds.length ? '' : 'disabled'}>↶ Runde</button>
    </div>
    ${state.endDecision === 'ausspielen' ? '<button class="btn danger" data-act="finish">Spiel beenden</button>' : ''}
  </div>`;
}

function ensureDraft() {
  if (!state.draft) {
    state.draft = { outId: null, values: {}, activeId: null };
  }
  const d = state.draft;
  // Spieler, die es nicht mehr gibt, entfernen
  Object.keys(d.values).forEach(id => { if (!byId(id)) delete d.values[id]; });
  if (d.outId && !byId(d.outId)) d.outId = null;
  if (!d.activeId || d.activeId === d.outId || !byId(d.activeId)) d.activeId = firstEmpty(d);
}

function firstEmpty(d, afterId) {
  const list = state.players;
  const start = afterId ? list.findIndex(p => p.id === afterId) + 1 : 0;
  for (let k = 0; k < list.length; k++) {
    const p = list[(start + k) % list.length];
    if (p.id !== d.outId && !d.values[p.id]) return p.id;
  }
  return null;
}

function renderRound() {
  ensureDraft();
  const d = state.draft;
  const t = totals();
  const n = state.rounds.length + 1;
  const missing = state.players.filter(p => p.id !== d.outId && !d.values[p.id]).length;
  const done = d.outId && missing === 0;
  const active = d.activeId ? byId(d.activeId) : null;
  const expr = active ? d.values[active.id] || '' : '';
  const sum = parseExpr(expr);
  const readout = `<div class="readout">
      <span class="who">${active ? esc(active.name) : (d.outId ? 'Alle erfasst' : 'Wer ist ausgegangen?')}</span>
      <span class="expr">${active ? (expr ? esc(expr) + (expr.includes('+') ? ` = ${sum}` : '') : '–') : ''}</span>
    </div>`;

  return `${topbar(`Runde ${n}`, { back: 'back-game' })}
  <div class="content has-pad">
    <div class="dealer-mini">🃏 Gemischt hat: <b>${esc(nameOf(state.nextShufflerId))}</b></div>
    <div class="section-title">Wer ist ausgegangen?</div>
    <div class="chips">${state.players.map(p =>
      `<button class="chip ${d.outId === p.id ? 'on' : ''}" data-act="set-out" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
    </div>
    <div class="section-title">Punkte der Restkarten</div>
    <ul class="entry">${state.players.map(p => {
      const isOut = p.id === d.outId;
      const v = d.values[p.id];
      const val = isOut ? 0 : parseExpr(v);
      const isActive = p.id === d.activeId;
      const now = t[p.id];
      const valueHtml = isOut
        ? `<b>0</b><small>ausgegangen</small>`
        : v
          ? `<b>${val}${isActive ? '<span class="caret"></span>' : ''}</b>${v.includes('+') ? `<small>${esc(v)}</small>` : ''}`
          : `<span class="empty">${isActive ? '<span class="caret"></span>' : '–'}</span>`;
      return `<li><button class="${isActive ? 'active' : ''} ${isOut ? 'out' : ''}" data-act="${isOut ? 'noop' : 'focus'}" data-id="${p.id}">
        <span class="ename">${esc(p.name)}</span>
        <span class="evalue">${valueHtml}</span>
        <span class="esub">${now}${val != null ? ` → ${now + val}` : ''}</span>
      </button></li>`;
    }).join('')}</ul>
    <button class="btn ghost small" data-act="discard-round">Eingabe verwerfen</button>
  </div>
  <div class="keypad" data-pad="round">${keypad({
    mode: 'cards',
    readout,
    goLabel: done ? 'Speichern ✓' : 'Weiter ›',
    goClass: done ? 'k-save' : 'k-go',
  })}</div>`;
}

function historyEntries() {
  // Runden und Korrekturen in chronologischer Reihenfolge, mit laufendem Stand.
  const entries = [];
  const run = {};
  state.players.forEach(p => { run[p.id] = 0; });
  const corrAt = k => state.corrections.filter(c => c.afterRound === k);
  const pushCorr = k => corrAt(k).forEach(c => {
    run[c.playerId] = (run[c.playerId] || 0) + c.delta;
    entries.push({ type: 'corr', c, total: run[c.playerId] });
  });
  pushCorr(0);
  state.rounds.forEach((r, i) => {
    const after = {};
    state.players.forEach(p => {
      run[p.id] = (run[p.id] || 0) + (r.points[p.id] || 0);
      after[p.id] = run[p.id];
    });
    entries.push({ type: 'round', r, n: i + 1, after });
    pushCorr(i + 1);
  });
  return entries.reverse();
}

function renderHistory() {
  const entries = historyEntries();
  const backTo = state.phase === 'over' ? 'back-over' : 'back-game';
  const body = entries.length ? entries.map(e => {
    if (e.type === 'corr') {
      const { c } = e;
      return `<div class="hcard corr"><header><b>Korrektur</b><span>nach Runde ${c.afterRound}</span></header>
        <table><tr><td>${esc(nameOf(c.playerId))}</td><td>${c.delta > 0 ? '+' : ''}${c.delta}</td><td>${e.total}</td></tr></table></div>`;
    }
    const { r, n, after } = e;
    return `<div class="hcard"><header><b>Runde ${n}</b>
      <span>🃏 ${esc(nameOf(r.shufflerId))} · 🏁 ${esc(nameOf(r.outId))}</span></header>
      <table>${state.players.map(p => `<tr class="${p.id === r.outId ? 'out' : ''}">
        <td>${esc(p.name)}</td><td>+${r.points[p.id] || 0}</td><td>${after[p.id]}</td></tr>`).join('')}</table></div>`;
  }).join('') : '<div class="empty-state">Noch keine Runden gespielt.</div>';
  return `${topbar('Verlauf', { back: backTo })}
  <div class="content">
    <p class="hint">Pro Runde: 🃏 Mischer · 🏁 ausgegangen. Spalten: Restkarten-Punkte, Stand danach.</p>
    ${body}
  </div>`;
}

function renderOver() {
  const s = standings();
  const best = s[0].pts;
  const winners = s.filter(p => p.pts === best);
  return `${topbar('Spiel beendet')}
  <div class="content">
    <div class="winner">
      <div class="trophy">🏆</div>
      <div>${winners.length > 1 ? 'Gewonnen haben' : 'Gewonnen hat'}</div>
      <div class="name">${winners.map(w => esc(w.name)).join(' & ')}</div>
      <div>mit ${best} Punkten nach ${state.rounds.length} Runden</div>
    </div>
    <div class="section-title">Schlussstand</div>
    ${renderStandingsList(false)}
    <button class="btn primary" data-act="new-game">Neues Spiel (gleiche Spieler)</button>
    <div class="btn-row">
      <button class="btn small" data-act="history">Verlauf</button>
      <button class="btn small" data-act="resume">Weiterspielen</button>
      <button class="btn small" data-act="undo">↶ Runde</button>
    </div>
  </div>`;
}

// ---------- Modale ----------

function renderModal() {
  let m = ui.modal;
  // Spielende-Frage ist abgeleitet und erscheint auch nach einem Neuladen wieder.
  if (!m && state.phase === 'game' && state.view === 'game' && anyOver() && state.endDecision === null) {
    m = { type: 'end' };
  }
  if (!m) return '';
  let inner = '';
  switch (m.type) {
    case 'confirm':
      inner = `<h2>${esc(m.title)}</h2><p>${esc(m.text)}</p>
        <div class="btn-row"><button class="btn ghost" data-act="modal-close">Abbrechen</button>
        <button class="btn ${m.danger ? 'primary' : 'green'}" data-act="modal-ok">${esc(m.ok)}</button></div>`;
      break;
    case 'end': {
      const t = totals();
      const over = state.players.filter(p => t[p.id] > state.target);
      inner = `<h2>Ziel überschritten!</h2>
        <p>${over.map(p => `<b style="color:var(--text)">${esc(p.name)}</b> (${t[p.id]})`).join(', ')} ${over.length > 1 ? 'sind' : 'ist'} über ${state.target} Punkten.
        Wird noch ausgespielt oder ist das Spiel fertig?</p>
        <div class="btn-row"><button class="btn ghost" data-act="end-play">Ausspielen</button>
        <button class="btn primary" data-act="finish-now">Spiel fertig</button></div>
        <button class="btn ghost small" data-act="undo">Letzte Runde zurücknehmen</button>`;
      break;
    }
    case 'menu':
      inner = `<h2>Menü</h2><div class="menu-list">
        <button class="btn" data-act="order">Reihenfolge, Namen & Mischer</button>
        <button class="btn" data-act="edit-target">Ziel ändern (${state.target})</button>
        <button class="btn" data-act="history">Verlauf aller Runden</button>
        <button class="btn" data-act="undo" ${state.rounds.length ? '' : 'disabled'}>Letzte Runde zurücknehmen</button>
        <button class="btn" data-act="finish">Spiel jetzt beenden</button>
        <button class="btn danger" data-act="new-game">Neues Spiel</button>
        <button class="btn ghost" data-act="modal-close">Schliessen</button></div>`;
      break;
    case 'order':
      inner = `<h2>Reihenfolge & Namen</h2>
        <p>Sitzordnung gegen den Uhrzeigersinn. Mit 🃏 festlegen, wer <b>jetzt</b> mischt.</p>
        ${playerRows(m.players, m.next, { removable: false, mixLabel: 'mischt jetzt' })}
        ${tableSvg(m.players, m.next)}
        <div class="btn-row"><button class="btn ghost" data-act="modal-close">Abbrechen</button>
        <button class="btn green" data-act="order-save">Übernehmen</button></div>`;
      break;
    case 'number': {
      const val = m.value === '' ? '<span style="color:var(--muted)">–</span>' : esc(m.value);
      inner = `<h2>${esc(m.title)}</h2>${m.text ? `<p>${m.text}</p>` : ''}
        <div class="bignum">${val}<span class="caret"></span>${m.sub ? `<small>${m.sub}</small>` : ''}</div>
        <div class="keypad inline" data-pad="number">${keypad({ mode: 'plain', goLabel: 'OK', goClass: 'k-save' })}</div>
        <button class="btn ghost" data-act="modal-close">Abbrechen</button>`;
      break;
    }
  }
  return `<div class="backdrop" data-act="${m.type === 'end' ? 'noop' : 'backdrop'}"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
}

function confirmModal(title, text, ok, onOk, danger = true) {
  ui.modal = { type: 'confirm', title, text, ok, onOk, danger };
  render();
}

function numberModal(opts) {
  ui.modal = { type: 'number', value: '', ...opts };
  render();
}

// ---------- Render ----------

function render() {
  const app = document.getElementById('app');
  let html;
  if (state.phase === 'setup') html = renderSetup();
  else if (state.view === 'history') html = renderHistory();
  else if (state.phase === 'over') html = renderOver();
  else if (state.view === 'round') html = renderRound();
  else html = renderGame();
  const scroll = window.scrollY;
  app.innerHTML = html + renderModal();
  window.scrollTo(0, scroll);
  document.body.style.overflow = ui.modal ? 'hidden' : '';
}

function go(view) {
  state.view = view;
  save();
  render();
  window.scrollTo(0, 0);
}

// ---------- Aktionen ----------

function movePlayer(list, id, dir) {
  const i = list.findIndex(p => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

function startGame() {
  const names = state.players.map(p => p.name.trim());
  if (state.players.length < MIN_PLAYERS) return toast(`Mindestens ${MIN_PLAYERS} Spieler`);
  if (names.some(n => !n)) return toast('Bitte alle Namen eintragen');
  if (new Set(names.map(n => n.toLowerCase())).size !== names.length) return toast('Namen müssen unterschiedlich sein');
  state.players.forEach((p, i) => { p.name = names[i]; });
  if (!byId(state.firstShufflerId)) state.firstShufflerId = state.players[0].id;
  state.phase = 'game';
  state.view = 'game';
  state.nextShufflerId = state.firstShufflerId;
  state.rounds = [];
  state.corrections = [];
  state.draft = null;
  state.endDecision = null;
  state.startedAt = Date.now();
  saveLast();
  save();
  render();
  window.scrollTo(0, 0);
}

function saveRound() {
  const d = state.draft;
  if (!d.outId) return toast('Wer ist ausgegangen?');
  const missing = state.players.find(p => p.id !== d.outId && !d.values[p.id]);
  if (missing) {
    d.activeId = missing.id;
    save(); render();
    return toast(`Punkte für ${missing.name} fehlen`);
  }
  const points = {};
  state.players.forEach(p => { points[p.id] = p.id === d.outId ? 0 : parseExpr(d.values[p.id]) || 0; });
  const shufflerId = state.nextShufflerId;
  state.rounds.push({ shufflerId, outId: d.outId, points, ts: Date.now() });
  state.nextShufflerId = nextAfter(state.players, shufflerId);
  state.draft = null;
  state.view = 'game';
  saveLast();
  save();
  render();
  window.scrollTo(0, 0);
  toast(`Runde ${state.rounds.length} gespeichert – jetzt mischt ${nameOf(state.nextShufflerId)}`);
}

function undoRound() {
  if (!state.rounds.length) return;
  const n = state.rounds.length;
  const doUndo = () => {
    const r = state.rounds.pop();
    // Korrekturen nach dieser Runde bleiben erhalten, rutschen aber vor die neu erfasste Runde.
    state.corrections.forEach(c => { if (c.afterRound > state.rounds.length) c.afterRound = state.rounds.length; });
    state.nextShufflerId = byId(r.shufflerId) ? r.shufflerId : state.nextShufflerId;
    const values = {};
    Object.keys(r.points).forEach(id => { if (id !== r.outId) values[id] = String(r.points[id]); });
    state.draft = { outId: r.outId, values, activeId: null };
    reconcileEnd();
    if (state.phase === 'over') state.phase = 'game';
    state.view = 'round';
    ui.modal = null;
    save();
    render();
    window.scrollTo(0, 0);
    toast(`Runde ${n} zurückgenommen – Werte zum Bearbeiten geladen`);
  };
  confirmModal(`Runde ${n} zurücknehmen?`,
    'Die Runde wird aus dem Stand entfernt und ihre Werte zum Korrigieren in die Eingabe geladen. Der Mischer springt zurück.',
    'Zurücknehmen', doUndo);
}

function openOrder() {
  ui.modal = {
    type: 'order',
    players: state.players.map(p => ({ ...p })),
    next: state.nextShufflerId,
    manual: false,
  };
  render();
}

function saveOrder() {
  const m = ui.modal;
  const names = m.players.map(p => p.name.trim());
  if (names.some(n => !n)) return toast('Bitte alle Namen eintragen');
  if (new Set(names.map(n => n.toLowerCase())).size !== names.length) return toast('Namen müssen unterschiedlich sein');
  state.players = m.players.map((p, i) => ({ id: p.id, name: names[i] }));
  state.nextShufflerId = m.next;
  ui.modal = null;
  saveLast();
  save();
  render();
  toast('Reihenfolge gespeichert');
}

function recomputeOrderNext() {
  const m = ui.modal;
  if (m.manual) return;
  const last = state.rounds[state.rounds.length - 1];
  if (last && m.players.some(p => p.id === last.shufflerId)) m.next = nextAfter(m.players, last.shufflerId);
}

function editTarget() {
  numberModal({
    title: 'Ziel ändern',
    text: 'Das Spiel endet, sobald jemand <b>über</b> diesem Wert ist.',
    sub: `bisher ${state.target}`,
    onOk(v) {
      const n = parseInt(v, 10);
      if (!n || n < 1) return toast('Bitte ein Ziel eingeben');
      state.target = n;
      reconcileEnd();
      ui.modal = null;
      saveLast();
      save();
      render();
    },
  });
}

function correctPlayer(id) {
  const current = totals()[id];
  numberModal({
    title: `${nameOf(id)} korrigieren`,
    text: 'Neuen Punktestand eingeben. Die Korrektur erscheint im Verlauf.',
    sub: `aktuell ${current}`,
    onOk(v) {
      if (v === '') return toast('Bitte neuen Stand eingeben');
      const delta = parseInt(v, 10) - current;
      ui.modal = null;
      if (delta !== 0) {
        state.corrections.push({ playerId: id, delta, afterRound: state.rounds.length, ts: Date.now() });
        reconcileEnd();
        save();
        toast(`${nameOf(id)}: ${current} → ${current + delta}`);
      }
      render();
    },
  });
}

function finishGame() {
  confirmModal('Spiel beenden?', 'Der aktuelle Stand wird als Schlussstand angezeigt.', 'Beenden', () => {
    ui.modal = null;
    state.phase = 'over';
    state.view = 'game';
    state.draft = null;
    save();
    render();
    window.scrollTo(0, 0);
  });
}

function newGame() {
  const doIt = () => {
    saveLast();
    ui.modal = null;
    state = freshState();
    save();
    render();
    window.scrollTo(0, 0);
  };
  if (state.phase === 'game' && (state.rounds.length || state.draft)) {
    confirmModal('Neues Spiel starten?', 'Der aktuelle Spielstand geht verloren. Spieler und Sitzordnung bleiben erhalten.', 'Neues Spiel', doIt);
  } else doIt();
}

// ---------- Events ----------

document.addEventListener('click', e => {
  const keyBtn = e.target.closest('[data-key]');
  if (keyBtn) return onKey(keyBtn.dataset.key, keyBtn.closest('[data-pad]').dataset.pad);

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  if (act === 'backdrop' && e.target !== el) return; // Klick im Sheet, nicht daneben

  const m = ui.modal;
  const inOrder = m && m.type === 'order';

  switch (act) {
    case 'noop': return;
    case 'backdrop':
    case 'modal-close': ui.modal = null; return render();
    case 'modal-ok': { const fn = m.onOk; ui.modal = null; fn(); return; }

    // Setup / Reihenfolge
    case 'add-player':
      if (state.players.length >= MAX_PLAYERS) return;
      state.players.push({ id: uid(), name: '' });
      save(); render();
      { const inputs = document.querySelectorAll('[data-name-id]'); inputs[inputs.length - 1].focus(); }
      return;
    case 'remove':
      if (state.players.length <= MIN_PLAYERS) return;
      state.players = state.players.filter(p => p.id !== id);
      if (state.firstShufflerId === id) state.firstShufflerId = state.players[0].id;
      save(); return render();
    case 'move-up':
    case 'move-down': {
      const dir = act === 'move-up' ? -1 : 1;
      if (inOrder) { movePlayer(m.players, id, dir); recomputeOrderNext(); }
      else { movePlayer(state.players, id, dir); save(); }
      return render();
    }
    case 'set-mix':
      if (inOrder) { m.next = id; m.manual = true; }
      else { state.firstShufflerId = id; save(); }
      return render();
    case 'start': return startGame();
    case 'order': ui.modal = null; return openOrder();
    case 'order-save': return saveOrder();
    case 'edit-target': ui.modal = null; return editTarget();

    // Spiel
    case 'menu': ui.modal = { type: 'menu' }; return render();
    case 'open-round': return go('round');
    case 'back-game': return go('game');
    case 'back-over': return go('game');
    case 'history': ui.modal = null; return go('history');
    case 'undo': ui.modal = null; return undoRound();
    case 'correct': return correctPlayer(id);
    case 'finish': ui.modal = null; return finishGame();
    case 'finish-now':
      state.phase = 'over'; state.view = 'game'; state.draft = null;
      save(); render(); return window.scrollTo(0, 0);
    case 'end-play':
      state.endDecision = 'ausspielen'; save(); return render();
    case 'resume':
      state.phase = 'game'; state.view = 'game';
      if (anyOver()) state.endDecision = 'ausspielen';
      save(); return render();
    case 'new-game': ui.modal = null; return newGame();

    // Runde
    case 'set-out': {
      const d = state.draft;
      if (d.outId === id) { d.outId = null; }
      else {
        d.outId = id;
        delete d.values[id];
      }
      d.activeId = d.activeId && d.activeId !== d.outId && !d.values[d.activeId] ? d.activeId : firstEmpty(d);
      save(); return render();
    }
    case 'focus': state.draft.activeId = id; save(); return render();
    case 'discard-round':
      return confirmModal('Eingabe verwerfen?', 'Alle Werte dieser Runde werden gelöscht.', 'Verwerfen', () => {
        state.draft = null; state.view = 'game'; save(); render();
      });
  }
});

document.addEventListener('input', e => {
  const id = e.target.dataset && e.target.dataset.nameId;
  if (!id) return;
  const list = ui.modal && ui.modal.type === 'order' ? ui.modal.players : state.players;
  const p = list.find(x => x.id === id);
  if (p) p.name = e.target.value;
  if (list === state.players) save();
  // Tischgrafik live nachführen, ohne den Fokus zu verlieren
  const svg = document.querySelector('.table-vis');
  if (svg) {
    const next = list === state.players ? state.firstShufflerId : ui.modal.next;
    svg.outerHTML = tableSvg(list, next);
  }
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
  const pad = document.querySelector(ui.modal ? '[data-pad="number"]' : '[data-pad="round"]');
  if (!pad) return;
  const map = { Backspace: 'back', Enter: 'go', Escape: 'clear', '+': 'plus' };
  const key = /^\d$/.test(e.key) ? e.key : map[e.key];
  if (key) { e.preventDefault(); onKey(key, pad.dataset.pad); }
});

function onKey(key, pad) {
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* ignore */ } }
  if (pad === 'number') {
    const m = ui.modal;
    if (key === 'go') return m.onOk(m.value);
    m.value = applyKey(m.value, key, { cards: false });
    return render();
  }
  const d = state.draft;
  if (!d) return;
  if (key === 'go') {
    const next = firstEmpty(d, d.activeId);
    if (!d.outId) return toast('Wer ist ausgegangen?');
    if (next) { d.activeId = next; save(); render(); return scrollActive(); }
    return saveRound();
  }
  if (!d.activeId) {
    if (!d.outId) return toast('Zuerst antippen, wer ausgegangen ist');
    return;
  }
  d.values[d.activeId] = applyKey(d.values[d.activeId], key, { cards: true });
  if (!d.values[d.activeId]) delete d.values[d.activeId];
  save();
  render();
}

function scrollActive() {
  const el = document.querySelector('.entry .active');
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Zustand auch beim Verlassen/Wegwischen sicher speichern
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
