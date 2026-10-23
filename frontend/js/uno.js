/*
 * UNO auf 300: Wer am Schluss am wenigsten Punkte hat, gewinnt.
 *
 * Reihenfolge der Spielerliste = Sitzordnung gegen den Uhrzeigersinn.
 * Damit ist der nächste Mischer immer der nächste Eintrag nach dem letzten Mischer.
 */
import {
  game, resetGame, save, render, show, ui, toast, esc, fmt, uid, topbar, keypad, applyKey, parseExpr,
  nextAfter, setupScreen, confirmModal, numberModal, rosterPlayers, rememberPlayers, checkNames,
} from './core.js';

const ID = 'uno';
const DEFAULT_TARGET = 300;
const BADGE = '<span class="logo uno">UNO</span>';

const S = () => game(ID);
const byId = id => S().players.find(p => p.id === id);
const nameOf = id => (byId(id) || { name: '?' }).name;

function fresh(prev) {
  const players = rosterPlayers();
  // Der nächste Mischer des letzten Spiels mischt auch im neuen Spiel zuerst.
  const want = prev && (prev.nextShufflerId || prev.firstId);
  return {
    phase: 'setup',          // setup | game | over
    view: 'game',            // game | round | history
    players,
    target: (prev && prev.target) || DEFAULT_TARGET,
    firstId: players.some(p => p.id === want) ? want : players[0].id,
    nextShufflerId: null,
    rounds: [],              // { shufflerId, outId, points: {id: n}, ts }
    corrections: [],         // { playerId, delta, afterRound, ts }
    draft: null,             // { outId, values: {id: 'expr'}, activeId }
    endDecision: null,       // null | 'ausspielen'
    startedAt: null,
  };
}

// ---------- Ableitungen ----------

function totals(uptoRound = Infinity) {
  const s = S();
  const t = {};
  s.players.forEach(p => { t[p.id] = 0; });
  s.rounds.forEach((r, i) => {
    if (i >= uptoRound) return;
    for (const id in r.points) t[id] = (t[id] || 0) + r.points[id];
  });
  s.corrections.forEach(c => {
    if (c.afterRound <= uptoRound) t[c.playerId] = (t[c.playerId] || 0) + c.delta;
  });
  return t;
}

function standings() {
  const t = totals();
  const order = S().players.map((p, i) => ({ ...p, seat: i, pts: t[p.id] }));
  order.sort((a, b) => a.pts - b.pts || a.seat - b.seat);
  return order;
}

function anyOver() {
  const s = S();
  const t = totals();
  return s.players.some(p => t[p.id] > s.target);
}

/** Wenn niemand mehr über dem Ziel ist, wird ein Spielende/Ausspielen zurückgesetzt. */
function reconcileEnd() {
  const s = S();
  if (!anyOver()) {
    s.endDecision = null;
    if (s.phase === 'over') { s.phase = 'game'; s.view = 'game'; }
  }
}

// ---------- Screens ----------

function dealerCard() {
  const s = S();
  return `<div class="dealer">
    <div class="cards">🃏</div>
    <div><div class="lbl">Mischt jetzt</div><div class="name">${esc(nameOf(s.nextShufflerId))}</div></div>
    <div class="meta">Runde<b>${s.rounds.length + 1}</b></div>
  </div>`;
}

function renderStandingsList(clickable) {
  const s = S();
  const t = s.target;
  return `<ol class="standings">${standings().map((p, i, arr) => {
    const rank = i > 0 && arr[i - 1].pts === p.pts ? '' : i + 1;
    const pct = Math.min(100, (p.pts / t) * 100);
    const cls = p.pts > t ? 'over' : pct >= 80 ? 'warn' : '';
    const rest = t - p.pts;
    const sub = p.pts > t ? `${-rest} über dem Ziel` : `noch ${rest} bis ${t}`;
    const tag = p.id === s.nextShufflerId && s.phase === 'game' ? '<span class="tag">🃏 mischt</span>' : '';
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
  const s = S();
  const banner = s.endDecision === 'ausspielen'
    ? '<div class="banner">Das Ziel ist überschritten – <b>es wird ausgespielt</b>. Spiel beenden, sobald ihr fertig seid.</div>' : '';
  return `${topbar(`Ziel ${s.target}`, { back: 'home', menu: true, badge: BADGE })}
  <div class="content">
    ${dealerCard()}
    ${banner}
    <button class="btn primary" data-act="open-round">${s.draft ? '✎ Angefangene Runde fortsetzen' : '＋ Runde erfassen'}</button>
    <div class="section-title">Stand</div>
    ${renderStandingsList(true)}
    <p class="hint">Tippe auf einen Spieler, um seinen Punktestand zu korrigieren.</p>
    <div class="btn-row">
      <button class="btn small" data-act="history">Verlauf</button>
      <button class="btn small" data-act="order">Reihenfolge</button>
      <button class="btn small" data-act="undo" ${s.rounds.length ? '' : 'disabled'}>↶ Runde</button>
    </div>
    ${s.endDecision === 'ausspielen' ? '<button class="btn danger" data-act="finish">Spiel beenden</button>' : ''}
  </div>`;
}

function ensureDraft() {
  const s = S();
  if (!s.draft) s.draft = { outId: null, values: {}, activeId: null };
  const d = s.draft;
  // Spieler, die es nicht mehr gibt, entfernen
  Object.keys(d.values).forEach(id => { if (!byId(id)) delete d.values[id]; });
  if (d.outId && !byId(d.outId)) d.outId = null;
  if (!d.activeId || d.activeId === d.outId || !byId(d.activeId)) d.activeId = firstEmpty(d);
}

function firstEmpty(d, afterId) {
  const list = S().players;
  const start = afterId ? list.findIndex(p => p.id === afterId) + 1 : 0;
  for (let k = 0; k < list.length; k++) {
    const p = list[(start + k) % list.length];
    if (p.id !== d.outId && !d.values[p.id]) return p.id;
  }
  return null;
}

const ROUND_KEYS = (goLabel, goClass) => [
  [['7'], ['8'], ['9'], ['⌫', 'back', 'k-op']],
  [['4'], ['5'], ['6'], ['+20<small>Aktion</small>', 'add:20', 'k-act']],
  [['1'], ['2'], ['3'], ['+50<small>Joker</small>', 'add:50', 'k-act']],
  [['+', 'plus', 'k-op'], ['0'], ['C', 'clear', 'k-op'], [goLabel, 'go', goClass]],
];

function renderRound() {
  ensureDraft();
  const s = S();
  const d = s.draft;
  const t = totals();
  const missing = s.players.filter(p => p.id !== d.outId && !d.values[p.id]).length;
  const done = d.outId && missing === 0;
  const active = d.activeId ? byId(d.activeId) : null;
  const expr = active ? d.values[active.id] || '' : '';
  const sum = parseExpr(expr);
  const readout = `<div class="readout">
      <span class="who">${active ? esc(active.name) : (d.outId ? 'Alle erfasst' : 'Wer ist ausgegangen?')}</span>
      <span class="expr">${active ? (expr ? esc(expr) + (expr.includes('+') ? ` = ${sum}` : '') : '–') : ''}</span>
    </div>`;

  return `${topbar(`Runde ${s.rounds.length + 1}`, { back: 'back-game', backLabel: '‹ Zurück', badge: BADGE })}
  <div class="content">
    <div class="dealer-mini">🃏 Gemischt hat: <b>${esc(nameOf(s.nextShufflerId))}</b></div>
    <div class="section-title">Wer ist ausgegangen?</div>
    <div class="chips">${s.players.map(p =>
      `<button class="chip ${d.outId === p.id ? 'on' : ''}" data-act="set-out" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
    </div>
    <div class="section-title">Punkte der Restkarten</div>
    <ul class="entry">${s.players.map(p => {
      const isOut = p.id === d.outId;
      const v = d.values[p.id];
      const val = isOut ? 0 : parseExpr(v);
      const isActive = p.id === d.activeId;
      const now = t[p.id];
      const valueHtml = isOut
        ? '<b>0</b><small>ausgegangen</small>'
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
  <div class="keypad dock" data-pad="round">${keypad(ROUND_KEYS(done ? 'Speichern ✓' : 'Weiter ›', done ? 'k-save' : 'k-go'), readout)}</div>`;
}

function historyEntries() {
  // Runden und Korrekturen in chronologischer Reihenfolge, mit laufendem Stand.
  const s = S();
  const entries = [];
  const run = {};
  s.players.forEach(p => { run[p.id] = 0; });
  const pushCorr = k => s.corrections.filter(c => c.afterRound === k).forEach(c => {
    run[c.playerId] = (run[c.playerId] || 0) + c.delta;
    entries.push({ type: 'corr', c, total: run[c.playerId] });
  });
  pushCorr(0);
  s.rounds.forEach((r, i) => {
    const after = {};
    s.players.forEach(p => {
      run[p.id] = (run[p.id] || 0) + (r.points[p.id] || 0);
      after[p.id] = run[p.id];
    });
    entries.push({ type: 'round', r, n: i + 1, after });
    pushCorr(i + 1);
  });
  return entries.reverse();
}

function renderHistory() {
  const s = S();
  const entries = historyEntries();
  const body = entries.length ? entries.map(e => {
    if (e.type === 'corr') {
      const { c } = e;
      return `<div class="hcard corr"><header><b>Korrektur</b><span>nach Runde ${c.afterRound}</span></header>
        <table><tr><td>${esc(nameOf(c.playerId))}</td><td>${c.delta > 0 ? '+' : ''}${c.delta}</td><td>${e.total}</td></tr></table></div>`;
    }
    const { r, n, after } = e;
    return `<div class="hcard"><header><b>Runde ${n}</b>
      <span>🃏 ${esc(nameOf(r.shufflerId))} · 🏁 ${esc(nameOf(r.outId))}</span></header>
      <table>${s.players.map(p => `<tr class="${p.id === r.outId ? 'out' : ''}">
        <td>${esc(p.name)}</td><td>+${r.points[p.id] || 0}</td><td>${after[p.id]}</td></tr>`).join('')}</table></div>`;
  }).join('') : '<div class="empty-state">Noch keine Runden gespielt.</div>';
  return `${topbar('Verlauf', { back: 'back-game', backLabel: '‹ Zurück', badge: BADGE })}
  <div class="content">
    <p class="hint">Pro Runde: 🃏 Mischer · 🏁 ausgegangen. Spalten: Restkarten-Punkte, Stand danach.</p>
    ${body}
  </div>`;
}

function renderOver() {
  const s = S();
  const st = standings();
  const best = st[0].pts;
  const winners = st.filter(p => p.pts === best);
  return `${topbar('Spiel beendet', { back: 'home', badge: BADGE })}
  <div class="content">
    <div class="winner">
      <div class="trophy">🏆</div>
      <div>${winners.length > 1 ? 'Gewonnen haben' : 'Gewonnen hat'}</div>
      <div class="name">${winners.map(w => esc(w.name)).join(' & ')}</div>
      <div>mit ${best} Punkten nach ${s.rounds.length} Runden</div>
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

function renderEndModal() {
  const s = S();
  const t = totals();
  const over = s.players.filter(p => t[p.id] > s.target);
  return `<h2>Ziel überschritten!</h2>
    <p>${over.map(p => `<b style="color:var(--text)">${esc(p.name)}</b> (${t[p.id]})`).join(', ')} ${over.length > 1 ? 'sind' : 'ist'} über ${s.target} Punkten.
    Wird noch ausgespielt oder ist das Spiel fertig?</p>
    <div class="btn-row"><button class="btn ghost" data-act="end-play">Ausspielen</button>
    <button class="btn primary" data-act="finish-now">Spiel fertig</button></div>
    <button class="btn ghost small" data-act="undo">Letzte Runde zurücknehmen</button>`;
}

// ---------- Aktionen ----------

function startGame() {
  const s = S();
  const err = checkNames(s.players);
  if (err) return toast(err);
  if (!byId(s.firstId)) s.firstId = s.players[0].id;
  Object.assign(s, {
    phase: 'game', view: 'game', nextShufflerId: s.firstId, rounds: [], corrections: [],
    draft: null, endDecision: null, startedAt: Date.now(), gid: uid(),
  });
  rememberPlayers(s.players);
  save();
  render();
  window.scrollTo(0, 0);
}

function saveRound() {
  const s = S();
  const d = s.draft;
  if (!d.outId) return toast('Wer ist ausgegangen?');
  const missing = s.players.find(p => p.id !== d.outId && !d.values[p.id]);
  if (missing) {
    d.activeId = missing.id;
    save(); render();
    return toast(`Punkte für ${missing.name} fehlen`);
  }
  const points = {};
  s.players.forEach(p => { points[p.id] = p.id === d.outId ? 0 : parseExpr(d.values[p.id]) || 0; });
  const shufflerId = s.nextShufflerId;
  s.rounds.push({ shufflerId, outId: d.outId, points, ts: Date.now() });
  s.nextShufflerId = nextAfter(s.players, shufflerId);
  s.draft = null;
  s.view = 'game';
  save();
  render();
  window.scrollTo(0, 0);
  toast(`Runde ${s.rounds.length} gespeichert – jetzt mischt ${nameOf(s.nextShufflerId)}`);
}

function undoRound() {
  const s = S();
  if (!s.rounds.length) return;
  const n = s.rounds.length;
  confirmModal(`Runde ${n} zurücknehmen?`,
    'Die Runde wird aus dem Stand entfernt und ihre Werte zum Korrigieren in die Eingabe geladen. Der Mischer springt zurück.',
    'Zurücknehmen', () => {
      const r = s.rounds.pop();
      // Korrekturen nach dieser Runde bleiben erhalten, rutschen aber vor die neu erfasste Runde.
      s.corrections.forEach(c => { if (c.afterRound > s.rounds.length) c.afterRound = s.rounds.length; });
      s.nextShufflerId = byId(r.shufflerId) ? r.shufflerId : s.nextShufflerId;
      const values = {};
      Object.keys(r.points).forEach(id => { if (id !== r.outId) values[id] = String(r.points[id]); });
      s.draft = { outId: r.outId, values, activeId: null };
      reconcileEnd();
      if (s.phase === 'over') s.phase = 'game';
      s.view = 'round';
      save();
      render();
      window.scrollTo(0, 0);
      toast(`Runde ${n} zurückgenommen – Werte zum Bearbeiten geladen`);
    });
}

function editTarget() {
  const s = S();
  numberModal({
    title: 'Ziel ändern',
    text: 'Das Spiel endet, sobald jemand <b>über</b> diesem Wert ist.',
    sub: `bisher ${s.target}`,
    onOk(v) {
      const n = parseInt(v, 10);
      if (!n || n < 1) return toast('Bitte ein Ziel eingeben');
      s.target = n;
      reconcileEnd();
      ui.modal = null;
      save();
      render();
    },
  });
}

function correctPlayer(id) {
  const s = S();
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
        s.corrections.push({ playerId: id, delta, afterRound: s.rounds.length, ts: Date.now() });
        reconcileEnd();
        save();
        toast(`${nameOf(id)}: ${current} → ${current + delta}`);
      }
      render();
    },
  });
}

function finishGame() {
  const s = S();
  confirmModal('Spiel beenden?', 'Der aktuelle Stand wird als Schlussstand angezeigt.', 'Beenden', () => {
    Object.assign(s, { phase: 'over', view: 'game', draft: null });
    save();
    render();
    window.scrollTo(0, 0);
  });
}

function newGame() {
  const s = S();
  const doIt = () => {
    resetGame(ID);
    save();
    render();
    window.scrollTo(0, 0);
  };
  if (s.phase === 'game' && (s.rounds.length || s.draft)) {
    confirmModal('Neues Spiel starten?', 'Der aktuelle Spielstand geht verloren. Spieler und Sitzordnung bleiben erhalten.', 'Neues Spiel', doIt);
  } else doIt();
}

function act(s, a, el) {
  const id = el.dataset.id;
  switch (a) {
    case 'start': return startGame();
    case 'edit-target': ui.modal = null; return editTarget();
    case 'open-round': return show(s, 'round');
    case 'back-game': return show(s, 'game');
    case 'history': ui.modal = null; return show(s, 'history');
    case 'undo': ui.modal = null; return undoRound();
    case 'correct': return correctPlayer(id);
    case 'finish': ui.modal = null; return finishGame();
    case 'finish-now':
      Object.assign(s, { phase: 'over', view: 'game', draft: null });
      save(); render(); return window.scrollTo(0, 0);
    case 'end-play':
      s.endDecision = 'ausspielen'; save(); return render();
    case 'resume':
      s.phase = 'game'; s.view = 'game';
      if (anyOver()) s.endDecision = 'ausspielen';
      save(); return render();
    case 'new-game': ui.modal = null; return newGame();

    // Runde
    case 'set-out': {
      const d = s.draft;
      if (d.outId === id) d.outId = null;
      else { d.outId = id; delete d.values[id]; }
      d.activeId = d.activeId && d.activeId !== d.outId && !d.values[d.activeId] ? d.activeId : firstEmpty(d);
      save(); return render();
    }
    case 'focus': s.draft.activeId = id; save(); return render();
    case 'discard-round':
      return confirmModal('Eingabe verwerfen?', 'Alle Werte dieser Runde werden gelöscht.', 'Verwerfen', () => {
        s.draft = null; s.view = 'game'; save(); render();
      });
  }
}

function key(s, k) {
  const d = s.draft;
  if (!d || s.view !== 'round') return;
  if (k === 'go') {
    const next = firstEmpty(d, d.activeId);
    if (!d.outId) return toast('Wer ist ausgegangen?');
    if (next) {
      d.activeId = next;
      save(); render();
      const el = document.querySelector('.entry .active');
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    return saveRound();
  }
  if (!d.activeId) {
    if (!d.outId) return toast('Zuerst antippen, wer ausgegangen ist');
    return;
  }
  d.values[d.activeId] = applyKey(d.values[d.activeId], k, { plus: true });
  if (!d.values[d.activeId]) delete d.values[d.activeId];
  save();
  render();
}

// ---------- Statistik ----------

/** Schlussstand für die Statistik, sobald das Spiel beendet ist. Gleicher Stand = gleicher Platz. */
function result(s) {
  if (s.phase !== 'over' || !s.rounds.length) return null;
  const t = totals();
  const outs = {};
  s.rounds.forEach(r => { outs[r.outId] = (outs[r.outId] || 0) + 1; });
  return {
    end: s.rounds[s.rounds.length - 1].ts,
    rounds: s.rounds.length,
    players: s.players.map(p => ({
      name: p.name,
      place: 1 + s.players.filter(q => t[q.id] < t[p.id]).length,
      score: t[p.id],
      outs: outs[p.id] || 0,
    })),
  };
}

const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

function playerStats(entries) {
  const rounds = sum(entries, e => e.g.rounds);
  const outs = sum(entries, e => e.p.outs || 0);
  return [
    ['Runden ausgegangen', `${outs} von ${rounds}${rounds ? ` · ${Math.round((outs / rounds) * 100)}%` : ''}`],
    ['Ø Schlussstand', fmt(Math.round(sum(entries, e => e.p.score) / entries.length))],
    ['Bester Schlussstand', fmt(Math.min(...entries.map(e => e.p.score)))],
  ];
}

function records(games) {
  const all = games.flatMap(g => g.players.map(p => ({ g, p })));
  const winners = all.filter(e => e.p.place === 1);
  const low = winners.reduce((a, e) => (!a || e.p.score < a.p.score ? e : a), null);
  const high = all.reduce((a, e) => (!a || e.p.score > a.p.score ? e : a), null);
  const long = games.reduce((a, g) => (!a || g.rounds > a.rounds ? g : a), null);
  return [
    low && { label: 'Tiefster Siegerstand', value: fmt(low.p.score), who: low.p.name, g: low.g },
    high && { label: 'Höchster Schlussstand', value: fmt(high.p.score), who: high.p.name, g: high.g },
    long && { label: 'Meiste Runden', value: long.rounds, g: long },
  ].filter(Boolean);
}

const RULES = `
  <h2>Ziel</h2>
  <p>Wer am Schluss <b>am wenigsten Punkte</b> hat, gewinnt. Gespielt wird, bis jemand <b>über 300</b> Punkte hat
  (das Ziel lässt sich ändern).</p>

  <h2>Ablauf einer Runde</h2>
  <ul>
    <li>Gespielt wird normales UNO. Wer alle Karten los ist, ist <b>ausgegangen</b> und bekommt 0 Punkte.</li>
    <li>Alle anderen zählen die Karten, die sie noch in der Hand haben, und bekommen diese Punkte.</li>
    <li>Gemischt wird reihum gegen den Uhrzeigersinn: Nach jeder Runde mischt die nächste Person nach dem letzten Mischer.</li>
  </ul>

  <h2>Kartenwerte</h2>
  <table>
    <tr><td>Zahlenkarten 0–9</td><td>Augenwert</td></tr>
    <tr><td>Aussetzen, Richtungswechsel, +2</td><td>20</td></tr>
    <tr><td>Farbwahl, +4 (Joker)</td><td>50</td></tr>
  </table>

  <h2>Spielende</h2>
  <p>Sobald jemand über dem Ziel ist, fragt die App: wird noch <b>ausgespielt</b> oder ist das Spiel <b>fertig</b>?
  Wer dann am wenigsten Punkte hat, gewinnt.</p>

  <h2>So funktioniert die App</h2>
  <ul>
    <li>Spieler in Sitzordnung <b>gegen den Uhrzeigersinn</b> eintragen und mit 🃏 wählen, wer zuerst mischt.</li>
    <li><b>Runde erfassen:</b> antippen, wer ausgegangen ist, dann für alle anderen die Restkarten eingeben.
      Mit <b>+20</b>, <b>+50</b> und <b>+</b> lassen sich die Karten einzeln zusammenzählen.</li>
    <li>Ein Spieler in der Rangliste antippen, um seinen Stand zu korrigieren.</li>
    <li><b>↶ Runde</b> nimmt die letzte Runde zurück und lädt ihre Werte zum Bearbeiten.</li>
  </ul>`;

export default {
  id: ID,
  title: 'UNO',
  tagline: 'Auf 300 – wer am wenigsten hat, gewinnt',
  badge: BADGE,
  mark: { emoji: '🃏', first: 'mischt zuerst', now: 'mischt jetzt', verb: 'mischt' },
  rules: RULES,
  fresh,
  result,
  playerStats,
  records,
  status(s) {
    if (s.phase === 'setup') return null;
    if (s.phase === 'over') return `Beendet nach ${s.rounds.length} Runden`;
    return `Läuft · Runde ${s.rounds.length + 1} · ${nameOf(s.nextShufflerId)} mischt`;
  },
  render(s) {
    if (s.phase === 'setup') {
      return setupScreen(this, s, {
        hint: 'Reihenfolge <b>gegen den Uhrzeigersinn</b> eintragen – so wandert das Mischen. Mit 🃏 festlegen, wer die erste Runde mischt.',
        fields: `<button class="field" data-act="edit-target">
          <span>Ziel (Spielende über …)</span><span class="val">${s.target} ›</span></button>`,
      });
    }
    if (s.view === 'history') return renderHistory();
    if (s.phase === 'over') return renderOver();
    if (s.view === 'round') return renderRound();
    return renderGame();
  },
  autoModal(s) {
    // Spielende-Frage ist abgeleitet und erscheint auch nach einem Neuladen wieder.
    if (s.phase === 'game' && s.view === 'game' && s.endDecision === null && anyOver()) return { type: 'end', locked: true };
    return null;
  },
  modal(s, m) {
    return m.type === 'end' ? renderEndModal() : '';
  },
  menu(s) {
    return [
      { label: 'Reihenfolge, Namen & Mischer', act: 'order' },
      { label: `Ziel ändern (${s.target})`, act: 'edit-target' },
      { label: 'Verlauf aller Runden', act: 'history' },
      { label: 'Letzte Runde zurücknehmen', act: 'undo', disabled: !s.rounds.length },
      { label: 'Spiel jetzt beenden', act: 'finish' },
      { label: 'Neues Spiel', act: 'new-game', cls: 'danger' },
    ];
  },
  orderCurrent: s => s.nextShufflerId,
  orderNext(s, players) {
    const last = s.rounds[s.rounds.length - 1];
    return last && players.some(p => p.id === last.shufflerId) ? nextAfter(players, last.shufflerId) : null;
  },
  orderSave(s, players, next) {
    s.players = players;
    s.nextShufflerId = next;
    return null;
  },
  act,
  key,
};
