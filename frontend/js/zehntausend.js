/*
 * 10'000erlen: Würfelspiel mit 6 Würfeln. Wer zuerst 10'000 Punkte hat, gewinnt;
 * die anderen spielen weiter um die restlichen Plätze.
 *
 * Gespeichert wird nur ein Protokoll (log) der Züge und Korrekturen. Stand, Rangliste
 * und wer dran ist, werden daraus nachgerechnet – so wirkt jede Änderung an einem
 * früheren Zug automatisch auf alles Spätere.
 */
import {
  game, resetGame, save, render, show, ui, toast, esc, fmt, uid, topbar, keypad, applyKey, parseExpr,
  nextAfter, setupScreen, confirmModal, numberModal, rosterPlayers, rememberPlayers, checkNames,
} from './core.js';

const ID = 'zehntausend';
const DEFAULT_TARGET = 10000;
const BADGE = '<span class="logo zehn">10K</span>';
const MEDALS = ['🥇', '🥈', '🥉'];

const S = () => game(ID);
const byId = id => S().players.find(p => p.id === id);
const nameOf = id => (byId(id) || { name: '?' }).name;

function fresh(prev) {
  const players = rosterPlayers();
  const want = prev && prev.firstId;
  return {
    phase: 'setup',          // setup | game
    view: 'game',            // game | history
    players,
    firstId: players.some(p => p.id === want) ? want : players[0].id,
    target: (prev && prev.target) || DEFAULT_TARGET,
    log: [],                 // { t: 'turn', pid, pts } | { t: 'set', pid, value } | { t: 'next', pid }
    draft: '',               // Eingabe für den aktuellen Zug, z.B. "1000+100+50"
    ended: false,            // von Hand beendet
    startedAt: null,
  };
}

// ---------- Nachrechnen ----------

function replay(s = S()) {
  const score = {};
  s.players.forEach(p => { score[p.id] = 0; });
  const done = [];           // Reihenfolge, in der das Ziel erreicht wurde (= Platz 1, 2, …)
  const active = id => !done.includes(id);
  let cur = s.firstId;
  const steps = [];
  s.log.forEach((e, i) => {
    const before = score[e.pid] || 0;
    let finished = null;
    if (e.t === 'turn' || e.t === 'set') {
      score[e.pid] = e.t === 'turn' ? before + e.pts : e.value;
      const reached = score[e.pid] >= s.target;
      const k = done.indexOf(e.pid);
      if (reached && k < 0) { done.push(e.pid); finished = done.length; }
      if (!reached && k >= 0) done.splice(k, 1); // per Korrektur wieder unter das Ziel
    }
    if (e.t === 'turn') cur = nextAfter(s.players, e.pid, active);
    else if (e.t === 'next') cur = e.pid;
    if (cur && !active(cur)) cur = nextAfter(s.players, cur, active);
    steps.push({ e, i, before, after: score[e.pid], finished });
  });
  const remaining = s.players.filter(p => active(p.id));
  const over = s.ended || (s.players.length > 1 && remaining.length <= 1);
  return { score, done, cur, steps, over };
}

/** Rangliste: wer das Ziel erreicht hat (in dieser Reihenfolge), danach nach Punkten. */
function ranking(s, r) {
  const fin = r.done.map((id, i) => ({ ...byId(id), place: i + 1, pts: r.score[id] }));
  const rest = s.players
    .map((p, seat) => ({ ...p, seat, pts: r.score[p.id] }))
    .filter(p => !r.done.includes(p.id))
    .sort((a, b) => b.pts - a.pts || a.seat - b.seat);
  return [...fin, ...rest];
}

const hasTurns = s => s.log.some(e => e.t === 'turn');

// ---------- Screens ----------

function standingsHtml(s, r, clickable) {
  const list = ranking(s, r);
  return `<ol class="standings">${list.map((p, i) => {
    const fin = p.place != null;
    const prev = list[i - 1];
    const rank = fin ? (MEDALS[p.place - 1] || `${p.place}.`) : (prev && prev.place == null && prev.pts === p.pts ? '' : i + 1);
    const pct = Math.min(100, (p.pts / s.target) * 100);
    const sub = fin ? `Ziel erreicht · Platz ${p.place}` : `noch ${fmt(s.target - p.pts)} bis ${fmt(s.target)}`;
    const tag = !r.over && p.id === r.cur ? '<span class="tag">🎲 dran</span>' : '';
    return `<li class="${fin ? 'done' : ''}"><button ${clickable ? `data-act="correct" data-id="${p.id}"` : 'disabled'}>
      <span class="rank">${rank}</span>
      <span class="pname">${esc(p.name)}${tag}</span>
      <span class="pts">${fmt(p.pts)}</span>
      <span class="bar"><i class="${fin ? 'gold' : ''}" style="width:${pct}%"></i></span>
      <span class="sub">${sub}</span>
    </button></li>`;
  }).join('')}</ol>`;
}

const TURN_KEYS = [
  [['+50', 'add:50', 'k-act'], ['+100', 'add:100', 'k-act'], ['+500', 'add:500', 'k-act'], ['⌫', 'back', 'k-op']],
  [['7'], ['8'], ['9'], ['+1000', 'add:1000', 'k-act']],
  [['4'], ['5'], ['6'], ['+1500<small>Strasse</small>', 'add:1500', 'k-act']],
  [['1'], ['2'], ['3'], ['C', 'clear', 'k-op']],
  [['00'], ['0'], ['Nuller<small>0 Punkte</small>', 'zero', 'k-op'], ['Speichern', 'go', 'k-save']],
];

function renderGame() {
  const s = S();
  const r = replay(s);
  const cur = r.cur;
  const now = r.score[cur] || 0;
  const pts = parseExpr(s.draft) || 0;
  const readout = `<div class="readout">
      <span class="who">${esc(nameOf(cur))} würfelt</span>
      <span class="expr">${s.draft
        ? `${esc(s.draft)}${s.draft.includes('+') ? ` = ${fmt(pts)}` : ''} → ${fmt(now + pts)}`
        : '–'}</span>
    </div>`;
  const winner = r.done.length
    ? `<div class="banner">🏆 <b>${esc(nameOf(r.done[0]))}</b> hat gewonnen. Die anderen spielen um die weiteren Plätze.</div>` : '';
  return `${topbar(`Ziel ${fmt(s.target)}`, { back: 'home', menu: true, badge: BADGE })}
  <div class="content">
    <div class="dealer">
      <div class="cards">🎲</div>
      <div><div class="lbl">Am Würfeln</div><div class="name">${esc(nameOf(cur))}</div></div>
      <div class="meta">Stand<b>${fmt(now)}</b>noch ${fmt(Math.max(0, s.target - now))}</div>
    </div>
    ${winner}
    <div class="section-title">Stand</div>
    ${standingsHtml(s, r, true)}
    <p class="hint">Tippe auf einen Spieler, um seinen Punktestand zu korrigieren.</p>
    <div class="btn-row">
      <button class="btn small" data-act="history">Verlauf</button>
      <button class="btn small" data-act="order">Reihenfolge</button>
      <button class="btn small" data-act="undo" ${hasTurns(s) ? '' : 'disabled'}>↶ Zug</button>
    </div>
  </div>
  <div class="keypad dock" data-pad="turn">${keypad(TURN_KEYS, readout)}</div>`;
}

function renderHistory() {
  const s = S();
  const r = replay(s);
  let n = 0;
  const rows = r.steps.map(st => ({ ...st, n: st.e.t === 'turn' ? ++n : null })).reverse();
  const body = rows.length ? rows.map(st => {
    const { e } = st;
    if (e.t === 'turn') {
      const medal = st.finished ? ` <span class="tag">${MEDALS[st.finished - 1] || '🏁'} Platz ${st.finished}</span>` : '';
      return `<button class="lrow" data-act="edit-turn" data-i="${st.i}">
        <span class="ln">${st.n}</span>
        <span class="lname">${esc(nameOf(e.pid))}${medal}</span>
        <span class="ld ${e.pts ? '' : 'zero'}">${e.pts ? `+${fmt(e.pts)}` : 'Nuller'}</span>
        <span class="lt">${fmt(st.after)}</span></button>`;
    }
    if (e.t === 'set') {
      return `<button class="lrow corr" data-act="edit-set" data-i="${st.i}">
        <span class="ln">✎</span>
        <span class="lname">${esc(nameOf(e.pid))} korrigiert</span>
        <span class="ld">${fmt(st.before)} →</span>
        <span class="lt">${fmt(st.after)}</span></button>`;
    }
    return `<div class="lrow note"><span class="ln">↻</span><span class="lname">Reihenfolge geändert: ${esc(nameOf(e.pid))} ist dran</span></div>`;
  }).join('') : '<div class="empty-state">Noch keine Züge gespielt.</div>';
  return `${topbar('Verlauf', { back: 'back-game', backLabel: '‹ Zurück', badge: BADGE })}
  <div class="content">
    <p class="hint">Neueste Züge zuoberst. Spalten: Punkte des Zugs, Stand danach. Antippen zum Ändern.</p>
    <div class="log">${body}</div>
  </div>`;
}

function renderOver() {
  const s = S();
  const r = replay(s);
  const list = ranking(s, r);
  const w = list[0];
  return `${topbar('Spiel beendet', { back: 'home', badge: BADGE })}
  <div class="content">
    <div class="winner">
      <div class="trophy">🏆</div>
      <div>Gewonnen hat</div>
      <div class="name">${esc(w.name)}</div>
      <div>mit ${fmt(w.pts)} Punkten</div>
    </div>
    <div class="section-title">Rangliste</div>
    ${standingsHtml(s, r, false)}
    <button class="btn primary" data-act="new-game">Neues Spiel (gleiche Spieler)</button>
    <div class="btn-row">
      <button class="btn small" data-act="history">Verlauf</button>
      ${s.ended ? '<button class="btn small" data-act="resume">Weiterspielen</button>' : ''}
      <button class="btn small" data-act="undo" ${hasTurns(s) ? '' : 'disabled'}>↶ Zug</button>
    </div>
  </div>`;
}

// ---------- Aktionen ----------

function startGame() {
  const s = S();
  const err = checkNames(s.players);
  if (err) return toast(err);
  if (!byId(s.firstId)) s.firstId = s.players[0].id;
  Object.assign(s, { phase: 'game', view: 'game', log: [], draft: '', ended: false, startedAt: Date.now(), gid: uid() });
  rememberPlayers(s.players);
  save();
  render();
  window.scrollTo(0, 0);
}

function saveTurn(pts) {
  const s = S();
  const before = replay(s);
  const pid = before.cur;
  s.log.push({ t: 'turn', pid, pts, ts: Date.now() });
  s.draft = '';
  save();
  const r = replay(s);
  const place = r.done.indexOf(pid) + 1;
  if (place && !before.done.includes(pid)) {
    ui.modal = { type: 'finished', pid, place };
  } else {
    toast(`${nameOf(pid)} ${pts ? `+${fmt(pts)}` : 'Nuller'} → ${fmt(r.score[pid])} · jetzt ${nameOf(r.cur)}`);
  }
  render();
  window.scrollTo(0, 0);
}

function undoTurn() {
  const s = S();
  const i = s.log.map(e => e.t).lastIndexOf('turn');
  if (i < 0) return;
  const e = s.log[i];
  confirmModal('Letzten Zug zurücknehmen?',
    `Der Zug von ${nameOf(e.pid)} (${e.pts ? `+${fmt(e.pts)}` : 'Nuller'}) wird entfernt und die Punkte zum Korrigieren ins Eingabefeld geladen.`,
    'Zurücknehmen', () => {
      // Ein späteres «wer ist dran» gehört zum zurückgenommenen Zug und fällt mit weg.
      s.log = s.log.filter((x, k) => k < i || (k > i && x.t !== 'next'));
      s.ended = false;
      s.view = 'game';
      s.draft = e.pts ? String(e.pts) : '';
      save();
      render();
      window.scrollTo(0, 0);
      toast(`Zug von ${nameOf(e.pid)} zurückgenommen`);
    });
}

function checkPoints(v) {
  if (v === '') return 'Bitte Punkte eingeben';
  if (parseInt(v, 10) % 50) return 'Punkte gibt es nur in 50er-Schritten';
  return null;
}

function editTurn(i) {
  const s = S();
  const e = s.log[i];
  const n = s.log.slice(0, i + 1).filter(x => x.t === 'turn').length;
  numberModal({
    title: `Zug ${n} von ${nameOf(e.pid)}`,
    text: 'Punkte für diesen Zug ändern. Alles Spätere wird neu berechnet.',
    sub: `bisher ${e.pts ? fmt(e.pts) : 'Nuller'}`,
    onOk(v) {
      const err = checkPoints(v);
      if (err) return toast(err);
      e.pts = parseInt(v, 10);
      ui.modal = null;
      save();
      render();
    },
    extra: [{
      label: 'Zug löschen', cls: 'danger',
      fn: () => confirmModal('Zug löschen?', `Der Zug von ${nameOf(e.pid)} wird aus dem Verlauf entfernt.`, 'Löschen', () => {
        s.log.splice(i, 1); save(); render();
      }),
    }],
  });
}

function editSet(i) {
  const s = S();
  const e = s.log[i];
  numberModal({
    title: `Korrektur ${nameOf(e.pid)}`,
    text: 'Punktestand dieser Korrektur ändern.',
    sub: `bisher ${fmt(e.value)}`,
    onOk(v) {
      if (v === '') return toast('Bitte Stand eingeben');
      e.value = parseInt(v, 10);
      ui.modal = null; save(); render();
    },
    extra: [{ label: 'Korrektur löschen', cls: 'danger', fn: () => { s.log.splice(i, 1); save(); render(); } }],
  });
}

function correctPlayer(id) {
  const s = S();
  const now = replay(s).score[id];
  numberModal({
    title: `${nameOf(id)} korrigieren`,
    text: 'Neuen Punktestand eingeben. Die Korrektur erscheint im Verlauf.',
    sub: `aktuell ${fmt(now)}`,
    onOk(v) {
      if (v === '') return toast('Bitte neuen Stand eingeben');
      const value = parseInt(v, 10);
      ui.modal = null;
      if (value !== now) {
        s.log.push({ t: 'set', pid: id, value, ts: Date.now() });
        save();
        toast(`${nameOf(id)}: ${fmt(now)} → ${fmt(value)}`);
      }
      render();
    },
  });
}

function editTarget() {
  const s = S();
  numberModal({
    title: 'Ziel ändern',
    text: 'Wer zuerst so viele Punkte hat, gewinnt.',
    sub: `bisher ${fmt(s.target)}`,
    onOk(v) {
      const n = parseInt(v, 10);
      if (!n || n < 50) return toast('Bitte ein Ziel eingeben');
      s.target = n;
      ui.modal = null; save(); render();
    },
  });
}

function newGame() {
  const s = S();
  const doIt = () => { resetGame(ID); save(); render(); window.scrollTo(0, 0); };
  if (s.phase === 'game' && !replay(s).over && (s.log.length || s.draft)) {
    confirmModal('Neues Spiel starten?', 'Der aktuelle Spielstand geht verloren. Spieler und Sitzordnung bleiben erhalten.', 'Neues Spiel', doIt);
  } else doIt();
}

function act(s, a, el) {
  const { id, i } = el.dataset;
  switch (a) {
    case 'start': return startGame();
    case 'edit-target': ui.modal = null; return editTarget();
    case 'back-game': return show(s, 'game');
    case 'history': ui.modal = null; return show(s, 'history');
    case 'undo': ui.modal = null; return undoTurn();
    case 'correct': return correctPlayer(id);
    case 'edit-turn': return editTurn(Number(i));
    case 'edit-set': return editSet(Number(i));
    case 'finish':
      ui.modal = null;
      return confirmModal('Spiel beenden?', 'Der aktuelle Stand wird als Rangliste angezeigt.', 'Beenden', () => {
        s.ended = true; s.view = 'game'; save(); render(); window.scrollTo(0, 0);
      });
    case 'resume': s.ended = false; save(); return render();
    case 'new-game': ui.modal = null; return newGame();
  }
}

function key(s, k) {
  if (s.view !== 'game' || replay(s).over) return;
  if (k === 'zero') return saveTurn(0);
  if (k === 'go') {
    if (!s.draft) return toast('Punkte eingeben – oder «Nuller» für 0');
    const err = checkPoints(String(parseExpr(s.draft)));
    if (err) return toast(err);
    return saveTurn(parseExpr(s.draft));
  }
  s.draft = applyKey(s.draft, k, { plus: true, maxLen: 5 });
  save();
  render();
}

// ---------- Statistik ----------

/**
 * Rangliste für die Statistik, sobald jemand gewonnen hat (oder von Hand beendet wurde).
 * Spielen die anderen weiter, wird der Eintrag laufend nachgeführt.
 */
function result(s) {
  const r = replay(s);
  if ((!r.done.length && !r.over) || !hasTurns(s)) return null;
  const per = {};
  s.players.forEach(p => { per[p.id] = { turns: 0, zeros: 0, best: 0 }; });
  s.log.forEach(e => {
    const x = e.t === 'turn' && per[e.pid];
    if (!x) return;
    x.turns++;
    if (!e.pts) x.zeros++;
    x.best = Math.max(x.best, e.pts);
  });
  const rest = s.players.filter(p => !r.done.includes(p.id));
  const place = id => {
    const k = r.done.indexOf(id);
    return k >= 0 ? k + 1 : r.done.length + 1 + rest.filter(q => r.score[q.id] > r.score[id]).length;
  };
  return {
    end: s.log[s.log.length - 1].ts,
    rounds: s.log.filter(e => e.t === 'turn').length,
    players: s.players.map(p => ({ name: p.name, place: place(p.id), score: r.score[p.id], ...per[p.id] })),
  };
}

function playerStats(entries) {
  const turns = entries.reduce((a, e) => a + (e.p.turns || 0), 0);
  const zeros = entries.reduce((a, e) => a + (e.p.zeros || 0), 0);
  return [
    ['Bester Zug', fmt(Math.max(...entries.map(e => e.p.best || 0)))],
    ['Züge', fmt(turns)],
    ['Nuller', `${fmt(zeros)}${turns ? ` · ${Math.round((zeros / turns) * 100)}%` : ''}`],
  ];
}

function records(games) {
  const all = games.flatMap(g => g.players.map(p => ({ g, p })));
  const best = all.reduce((a, e) => (!a || (e.p.best || 0) > (a.p.best || 0) ? e : a), null);
  const zeros = all.reduce((a, e) => (!a || (e.p.zeros || 0) > (a.p.zeros || 0) ? e : a), null);
  return [
    best && { label: 'Bester Zug', value: fmt(best.p.best || 0), who: best.p.name, g: best.g },
    zeros && zeros.p.zeros && { label: 'Meiste Nuller in einem Spiel', value: zeros.p.zeros, who: zeros.p.name, g: zeros.g },
  ].filter(Boolean);
}

const RULES = `
  <h2>Ziel</h2>
  <p>Wer zuerst <b>10'000 Punkte</b> hat, gewinnt. Die anderen spielen weiter, bis die ganze Rangliste feststeht.</p>

  <h2>Wer beginnt?</h2>
  <p>Zuerst würfelt jeder einmal. Wer am höchsten hat, beginnt. Danach geht es reihum
  <b>gegen den Uhrzeigersinn</b>.</p>

  <h2>Ein Zug</h2>
  <ol>
    <li>Mit <b>allen 6 Würfeln</b> würfeln.</li>
    <li>Nach jedem Wurf muss <b>mindestens eine Wertung</b> herausgelegt werden (siehe unten).</li>
    <li>Mit den übrigen Würfeln darf man <b>nochmals würfeln</b> – oder aufhören und die Punkte aufschreiben.</li>
    <li>Kommt bei einem Wurf <b>keine Wertung</b>, ist der Zug vorbei und gibt <b>0 Punkte</b> («Nuller»).
      Alles, was man in diesem Zug schon gesammelt hat, verfällt.</li>
    <li>Sind <b>alle 6 Würfel</b> gewertet, darf man nochmals mit allen 6 beginnen und zählt weiter dazu.</li>
  </ol>

  <h2>Wertungen</h2>
  <table>
    <tr><td>Strasse (1–2–3–4–5–6)</td><td>1'500</td></tr>
    <tr><td>3 × die Eins</td><td>1'000</td></tr>
    <tr><td>3 × die Fünf</td><td>500</td></tr>
    <tr><td>1 × Eins</td><td>100</td></tr>
    <tr><td>1 × Fünf</td><td>50</td></tr>
  </table>
  <p class="ex">Beispiel: Wurf 1-1-1-5-3-4 → 1'000 + 50 = 1'050 herauslegen und mit den 2 übrigen Würfeln weiterwürfeln
  oder aufhören.</p>

  <h2>So funktioniert die App</h2>
  <ul>
    <li>Spieler in Sitzordnung <b>gegen den Uhrzeigersinn</b> eintragen und mit 🎲 wählen, wer beginnt.</li>
    <li>Oben steht, wer <b>am Würfeln</b> ist. Nach dem Zug die Punkte eingeben und <b>Speichern</b> –
      dann ist automatisch die nächste Person dran.</li>
    <li>Mit <b>+50</b>, <b>+100</b>, <b>+500</b>, <b>+1000</b> und <b>+1500</b> lassen sich die Wertungen einfach zusammentippen.
      <b>Nuller</b> speichert direkt 0 Punkte.</li>
    <li>Wer das Ziel erreicht, bekommt seinen Platz und wird danach übersprungen.</li>
    <li>Im <b>Verlauf</b> lässt sich jeder Zug ändern oder löschen, <b>↶ Zug</b> nimmt den letzten Zug zurück.
      Ein Spieler in der Rangliste antippen, um seinen Stand direkt zu korrigieren.</li>
  </ul>`;

export default {
  id: ID,
  title: "10'000erlen",
  tagline: "6 Würfel – wer zuerst 10'000 hat, gewinnt",
  badge: BADGE,
  mark: { emoji: '🎲', first: 'beginnt', now: 'ist dran', verb: 'würfelt' },
  rules: RULES,
  fresh,
  result,
  playerStats,
  records,
  status(s) {
    if (s.phase === 'setup') return null;
    const r = replay(s);
    if (r.over) return `Beendet · gewonnen hat ${nameOf(ranking(s, r)[0].id)}`;
    return `Läuft · ${nameOf(r.cur)} würfelt${r.done.length ? ` · ${nameOf(r.done[0])} hat gewonnen` : ''}`;
  },
  render(s) {
    if (s.phase === 'setup') {
      return setupScreen(this, s, {
        hint: 'Zuerst würfelt jeder einmal – wer am höchsten hat, beginnt. Reihenfolge <b>gegen den Uhrzeigersinn</b> eintragen und mit 🎲 festlegen, wer beginnt.',
        fields: `<button class="field" data-act="edit-target">
          <span>Ziel</span><span class="val">${fmt(s.target)} ›</span></button>`,
      });
    }
    if (s.view === 'history') return renderHistory();
    if (replay(s).over) return renderOver();
    return renderGame();
  },
  modal(s, m) {
    if (m.type !== 'finished') return '';
    const r = replay(s);
    return `<div class="celebrate">${MEDALS[m.place - 1] || '🏁'}</div>
      <h2>${esc(nameOf(m.pid))} hat ${fmt(s.target)} erreicht!</h2>
      <p>${m.place === 1 ? '<b>Gewonnen!</b> ' : ''}Das ist Platz ${m.place}.
      ${r.over ? 'Damit ist das Spiel fertig.' : `Weiter geht es mit <b>${esc(nameOf(r.cur))}</b>.`}</p>
      <button class="btn primary" data-act="modal-close">Weiter</button>
      <button class="btn ghost small" data-act="undo">Zug zurücknehmen</button>`;
  },
  menu(s) {
    return [
      { label: 'Reihenfolge, Namen & wer dran ist', act: 'order' },
      { label: `Ziel ändern (${fmt(s.target)})`, act: 'edit-target' },
      { label: 'Verlauf aller Züge', act: 'history' },
      { label: 'Letzten Zug zurücknehmen', act: 'undo', disabled: !hasTurns(s) },
      { label: 'Spiel jetzt beenden', act: 'finish' },
      { label: 'Neues Spiel', act: 'new-game', cls: 'danger' },
    ];
  },
  orderCurrent: s => replay(s).cur,
  orderNext(s, players) {
    const r = replay(s);
    const last = [...s.log].reverse().find(e => e.t === 'turn');
    return last ? nextAfter(players, last.pid, id => !r.done.includes(id)) : null;
  },
  orderSave(s, players, next) {
    if (replay(s).done.includes(next)) return 'Wer das Ziel erreicht hat, würfelt nicht mehr';
    s.players = players;
    if (replay(s).cur !== next) s.log.push({ t: 'next', pid: next, ts: Date.now() });
    return null;
  },
  act,
  key,
};
