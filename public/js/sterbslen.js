/*
 * Sterbslen: Würfelspiel mit 6 Würfeln rund um die 30. Wer zuletzt noch im Spiel ist, gewinnt.
 *
 * - Startrunde: Augensumme = Startstand.
 * - Danach: unter 30 → Differenz bei sich abziehen; genau 30 → nichts;
 *   über 30 → Überschuss x bei sich dazuzählen, dann Bonuswurf auf die Augenzahl x.
 *   Treffer × x wird dem Vorgänger abgezogen. Was dieser nicht mehr tragen kann,
 *   geht weiter an den Vorvorgänger usw. und zuletzt an einen selbst.
 * - Wer auf 0 steht, muss im nächsten Zug über 30 würfeln, sonst ist er raus.
 *
 * Gespeichert wird nur ein Protokoll (log); der Stand wird daraus nachgerechnet.
 */
import {
  game, resetGame, save, render, show, ui, toast, esc, topbar, keypad, applyKey,
  nextAfter, setupScreen, confirmModal, numberModal, rosterPlayers, rememberPlayers, checkNames,
} from './core.js';

const ID = 'sterbslen';
const LIMIT = 30;
const BADGE = '<span class="logo sterb">30</span>';
const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'].map(f => f && `<span class="die">${f}</span>`);
const FACE_NAME = ['', 'Einer', 'Zweier', 'Dreier', 'Vierer', 'Fünfer', 'Sechser'];

const S = () => game(ID);
const byId = id => S().players.find(p => p.id === id);
const nameOf = id => (byId(id) || { name: '?' }).name;
const emptyDraft = () => ({ roll: '', stage: 'roll', hits: null });
const validRoll = n => Number.isInteger(n) && n >= 6 && n <= 36;

function fresh(prev) {
  const players = rosterPlayers();
  const want = prev && prev.firstId;
  return {
    phase: 'setup',          // setup | game
    view: 'game',            // game | history
    players,
    firstId: players.some(p => p.id === want) ? want : players[0].id,
    // { t: 'turn', pid, roll, hits } | { t: 'set', pid, value } | { t: 'out', pid } | { t: 'next', pid }
    log: [],
    draft: emptyDraft(),
    ended: false,
    startedAt: null,
  };
}

// ---------- Nachrechnen ----------

/** Alle anderen noch aktiven Spieler rückwärts ab dem Vorgänger, zuletzt man selbst. */
function damageChain(players, pid, alive) {
  const i = players.findIndex(p => p.id === pid);
  const chain = [];
  for (let k = 1; k < players.length; k++) {
    const q = players[(i - k + players.length * 2) % players.length].id;
    if (alive(q)) chain.push(q);
  }
  chain.push(pid);
  return chain;
}

function replay(s = S(), log = s.log) {
  const score = {};
  s.players.forEach(p => { score[p.id] = 0; });
  const started = new Set();
  const out = [];            // Reihenfolge des Ausscheidens
  const alive = id => !out.includes(id);
  let cur = s.firstId;
  const steps = [];

  log.forEach((e, i) => {
    const fx = [];           // Änderungen: { pid, from, to }
    const info = {};
    const change = (pid, to) => { fx.push({ pid, from: score[pid], to }); score[pid] = to; };

    if (e.t === 'turn') {
      const p = e.pid;
      if (!started.has(p)) {
        started.add(p);
        info.kind = 'start';
        change(p, e.roll);
      } else if (score[p] === 0 && e.roll <= LIMIT) {
        info.kind = 'out';
        out.push(p);
      } else if (e.roll < LIMIT) {
        info.kind = 'minus';
        change(p, Math.max(0, score[p] - (LIMIT - e.roll)));
      } else if (e.roll === LIMIT) {
        info.kind = 'even';
      } else {
        const x = e.roll - LIMIT;
        Object.assign(info, { kind: 'plus', face: x, rescue: score[p] === 0, dmg: (e.hits || 0) * x });
        change(p, score[p] + x);
        let rest = info.dmg;
        for (const q of damageChain(s.players, p, alive)) {
          if (!rest) break;
          const take = Math.min(score[q], rest);
          if (take) { change(q, score[q] - take); rest -= take; }
        }
        info.lost = rest;
      }
      cur = nextAfter(s.players, p, alive);
    } else if (e.t === 'set') {
      const k = out.indexOf(e.pid);
      if (k >= 0) { out.splice(k, 1); info.back = true; }
      started.add(e.pid);
      change(e.pid, e.value);
    } else if (e.t === 'out') {
      if (alive(e.pid)) out.push(e.pid);
    } else if (e.t === 'next') {
      cur = e.pid;
    }
    if (cur && !alive(cur)) cur = nextAfter(s.players, cur, alive);
    steps.push({ e, i, fx, info });
  });

  const aliveList = s.players.filter(p => alive(p.id));
  return {
    score, started, out, cur, steps, alive,
    startRound: aliveList.some(p => !started.has(p.id)),
    over: s.ended || (s.players.length > 1 && aliveList.length <= 1),
  };
}

/** Platz eines ausgeschiedenen Spielers (wer zuerst raus ist, wird Letzter). */
const placeOf = (s, r, id) => s.players.length - r.out.indexOf(id);

function ranking(s, r) {
  const alive = s.players
    .map((p, seat) => ({ ...p, seat, pts: r.score[p.id] }))
    .filter(p => r.alive(p.id))
    .sort((a, b) => b.pts - a.pts || a.seat - b.seat);
  const gone = [...r.out].reverse().map(id => ({ ...byId(id), pts: 0, out: true }));
  return [...alive, ...gone];
}

const hasTurns = s => s.log.some(e => e.t === 'turn');
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/** Kurzbeschreibung eines Zugs, z.B. "Anna +2 (27) · Ben −6 (4)". */
function summary(st) {
  const { e, info, fx } = st;
  if (info.kind === 'start') return `${nameOf(e.pid)} startet mit ${e.roll}`;
  if (info.kind === 'out') return `${nameOf(e.pid)} ist raus`;
  if (info.kind === 'even') return `${nameOf(e.pid)}: genau 30 – nichts passiert`;
  return fx.map(f => `${nameOf(f.pid)} ${signed(f.to - f.from)} (${f.to})`).join(' · ');
}

// ---------- Screens ----------

function standingsHtml(s, r) {
  const max = Math.max(1, ...s.players.map(p => r.score[p.id]));
  return `<ol class="standings seats">${s.players.map((p, i) => {
    const isOut = !r.alive(p.id);
    const pts = r.score[p.id];
    let tag = '';
    if (isOut) tag = `<span class="tag muted">raus · Platz ${placeOf(s, r, p.id)}</span>`;
    else if (p.id === r.cur && !r.over) tag = '<span class="tag">🎲 dran</span>';
    let sub = '';
    if (isOut) sub = 'ausgeschieden';
    else if (!r.started.has(p.id)) sub = 'Startwurf offen';
    else if (pts === 0) sub = '<span class="warn">auf 0 – muss sich retten</span>';
    else sub = `Vorgänger: ${esc(nameOf(prevAlive(s, r, p.id)))}`;
    return `<li class="${isOut ? 'out' : ''}"><button data-act="correct" data-id="${p.id}">
      <span class="rank">${i + 1}</span>
      <span class="pname">${esc(p.name)}${tag}</span>
      <span class="pts">${isOut ? '–' : pts}</span>
      <span class="bar"><i style="width:${isOut ? 0 : (pts / max) * 100}%"></i></span>
      <span class="sub">${sub}</span>
    </button></li>`;
  }).join('')}</ol>`;
}

function prevAlive(s, r, id) {
  const chain = damageChain(s.players, id, r.alive);
  return chain.length > 1 ? chain[0] : id;
}

/** Vorschau: der Zug, wie er mit der aktuellen Eingabe gespeichert würde. */
function previewStep(s, r, roll, hits) {
  if (!validRoll(roll)) return null;
  const rr = replay(s, [...s.log, { t: 'turn', pid: r.cur, roll, hits: hits == null ? 0 : hits }]);
  return rr.steps[rr.steps.length - 1];
}

function shortPreview(st) {
  const { e, info, fx } = st;
  switch (info.kind) {
    case 'start': return `Startwert ${e.roll}`;
    case 'out': return 'raus';
    case 'even': return 'genau 30';
    case 'minus': return `${signed(fx[0].to - fx[0].from)} → ${fx[0].to}`;
    default: return `+${info.face} · Bonus auf ${FACE[info.face]}`;
  }
}

const ROLL_KEYS = (goLabel, goClass) => [
  [['7'], ['8'], ['9'], ['⌫', 'back', 'k-op']],
  [['4'], ['5'], ['6'], ['C', 'clear', 'k-op']],
  [['1'], ['2'], ['3'], null],
  [null, ['0'], null, [goLabel, 'go', goClass]],
];

function rollPad(s, r) {
  const d = s.draft;
  const roll = parseInt(d.roll, 10);
  const st = previewStep(s, r, roll, null);
  const bonus = st && st.info.kind === 'plus';
  const readout = `<div class="readout">
      <span class="who">${esc(nameOf(r.cur))}: Augensumme</span>
      <span class="expr">${d.roll ? `${esc(d.roll)}${st ? ` → ${shortPreview(st)}` : ''}` : '–'}</span>
    </div>`;
  return keypad(ROLL_KEYS(bonus ? 'Weiter ›' : 'Speichern', bonus ? 'k-go' : 'k-save'), readout);
}

function hitsPad(s, r) {
  const d = s.draft;
  const x = parseInt(d.roll, 10) - LIMIT;
  const st = d.hits == null ? null : previewStep(s, r, x + LIMIT, d.hits);
  const chip = k => [`${k}<small>= ${k * x}</small>`, `hits:${k}`, d.hits === k ? 'sel' : ''];
  const fx = st ? st.fx.filter(f => f.pid !== r.cur) : [];
  const effect = !st ? 'Wie viele hast du insgesamt herausgelegt?'
    : st.info.dmg === 0 ? 'Kein Treffer – niemandem wird etwas abgezogen.'
      : fx.map(f => `${esc(nameOf(f.pid))} −${f.from - f.to} (${f.from} → ${f.to})`).join(' · ')
        + (st.info.lost ? ` · ${st.info.lost} verfallen` : '')
        + (st.fx.some(f => f.pid === r.cur && f.to < f.from) ? ' · Rest bei dir selbst' : '');
  const readout = `<div class="readout">
      <span class="who">${esc(nameOf(r.cur))}: ${d.roll} → Bonuswurf auf ${FACE[x]} ${FACE_NAME[x]}</span>
      <span class="expr">${d.hits == null ? '–' : `${d.hits} × ${x} = ${d.hits * x}`}</span>
    </div>
    <div class="fx">${effect}</div>`;
  return keypad([
    [chip(0), chip(1), chip(2), chip(3)],
    [chip(4), chip(5), chip(6), ['‹ Wurf', 'roll-back', 'k-op']],
    [['Speichern ✓', 'go', 'k-save wide']],
  ], readout);
}

function renderGame() {
  const s = S();
  const r = replay(s);
  const cur = r.cur;
  const me = r.score[cur];
  const isStart = !r.started.has(cur);
  const rescue = !isStart && me === 0;
  const pred = prevAlive(s, r, cur);
  const label = isStart ? 'Startwurf' : rescue ? 'Rettungswurf' : 'Am Würfeln';
  let banner = '';
  if (r.startRound) {
    banner = '<div class="banner"><b>Startrunde:</b> Jeder würfelt einmal mit allen 6 Würfeln. Die Augensumme ist der Startstand.</div>';
  } else if (rescue) {
    banner = `<div class="banner warn">⚠️ <b>${esc(nameOf(cur))}</b> steht auf 0 und muss <b>über 30</b> würfeln – sonst ist ${esc(nameOf(cur))} raus.</div>`;
  }
  return `${topbar('Sterbslen', { back: 'home', menu: true, badge: BADGE })}
  <div class="content">
    <div class="dealer">
      <div class="cards">🎲</div>
      <div><div class="lbl">${label}</div><div class="name">${esc(nameOf(cur))}</div></div>
      ${isStart ? '' : `<div class="meta">Stand<b>${me}</b></div>`}
    </div>
    ${!isStart && pred !== cur ? `<div class="dealer-mini">Vorgänger: <b>${esc(nameOf(pred))}</b> (${r.score[pred]})</div>` : ''}
    ${banner}
    <div class="section-title">Stand · Sitzordnung</div>
    ${standingsHtml(s, r)}
    <p class="hint">Tippe auf einen Spieler, um seinen Stand zu korrigieren.</p>
    <div class="btn-row">
      <button class="btn small" data-act="history">Verlauf</button>
      <button class="btn small" data-act="order">Reihenfolge</button>
      <button class="btn small" data-act="undo" ${hasTurns(s) ? '' : 'disabled'}>↶ Zug</button>
    </div>
  </div>
  <div class="keypad dock" data-pad="turn">${s.draft.stage === 'hits' ? hitsPad(s, r) : rollPad(s, r)}</div>`;
}

function describe(st) {
  const { e, info } = st;
  switch (info.kind) {
    case 'start': return 'Startwurf';
    case 'out': return 'Rettung misslungen – raus';
    case 'even': return 'Genau 30 – nichts passiert';
    case 'minus': return `Unter 30 – ${LIMIT - e.roll} bei sich abziehen`;
    default:
      return `${info.rescue ? 'Gerettet! ' : ''}Bonus ${e.hits || 0} × ${FACE[info.face]} = ${info.dmg}`
        + (info.lost ? ` · ${info.lost} verfallen` : '');
  }
}

function renderHistory() {
  const s = S();
  const r = replay(s);
  let n = 0;
  const rows = r.steps.map(st => ({ ...st, n: st.e.t === 'turn' ? ++n : null })).reverse();
  const fxTable = fx => fx.length ? `<table>${fx.map(f => `<tr><td>${esc(nameOf(f.pid))}</td>
    <td>${signed(f.to - f.from)}</td><td>${f.to}</td></tr>`).join('')}</table>` : '';
  const body = rows.length ? rows.map(st => {
    const { e } = st;
    if (e.t === 'turn') {
      return `<div class="hcard tap" data-act="edit-turn" data-i="${st.i}">
        <header><b>${st.n}. ${esc(nameOf(e.pid))}</b><span>Wurf ${e.roll}</span></header>
        ${fxTable(st.fx)}<div class="note">${describe(st)}</div></div>`;
    }
    if (e.t === 'set') {
      return `<div class="hcard corr tap" data-act="edit-set" data-i="${st.i}">
        <header><b>Korrektur</b><span>${st.info.back ? 'wieder im Spiel' : ''}</span></header>${fxTable(st.fx)}</div>`;
    }
    if (e.t === 'out') {
      return `<div class="hcard corr tap" data-act="edit-out" data-i="${st.i}">
        <header><b>Korrektur</b><span></span></header><div class="note">${esc(nameOf(e.pid))} aus dem Spiel genommen</div></div>`;
    }
    return `<div class="lrow note"><span class="ln">↻</span><span class="lname">Reihenfolge geändert: ${esc(nameOf(e.pid))} ist dran</span></div>`;
  }).join('') : '<div class="empty-state">Noch keine Züge gespielt.</div>';
  return `${topbar('Verlauf', { back: 'back-game', backLabel: '‹ Zurück', badge: BADGE })}
  <div class="content">
    <p class="hint">Neueste Züge zuoberst. Spalten: Änderung, Stand danach. Antippen zum Ändern.</p>
    ${body}
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
      <div>mit ${w.pts} Punkten</div>
    </div>
    <div class="section-title">Rangliste</div>
    <ol class="standings">${list.map((p, i) => `<li class="${p.out ? 'out' : ''}"><button disabled>
      <span class="rank">${i + 1}</span><span class="pname">${esc(p.name)}</span>
      <span class="pts">${p.out ? '–' : p.pts}</span><span class="bar"></span>
      <span class="sub">${p.out ? 'ausgeschieden' : 'noch im Spiel'}</span></button></li>`).join('')}</ol>
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
  Object.assign(s, { phase: 'game', view: 'game', log: [], draft: emptyDraft(), ended: false, startedAt: Date.now() });
  rememberPlayers(s.players);
  save();
  render();
  window.scrollTo(0, 0);
}

function saveTurn() {
  const s = S();
  const before = replay(s);
  const pid = before.cur;
  const roll = parseInt(s.draft.roll, 10);
  const bonus = before.started.has(pid) && roll > LIMIT;
  s.log.push({ t: 'turn', pid, roll, hits: bonus ? s.draft.hits : null, ts: Date.now() });
  s.draft = emptyDraft();
  save();
  const r = replay(s);
  const st = r.steps[r.steps.length - 1];
  if (st.info.kind === 'out') ui.modal = { type: 'out', pid, roll, place: placeOf(s, r, pid) };
  else if (!r.over) toast(`${summary(st)} · jetzt ${nameOf(r.cur)}`, 3500);
  render();
  window.scrollTo(0, 0);
}

function undoTurn() {
  const s = S();
  const i = s.log.map(e => e.t).lastIndexOf('turn');
  if (i < 0) return;
  const e = s.log[i];
  confirmModal('Letzten Zug zurücknehmen?',
    `Der Zug von ${nameOf(e.pid)} (Wurf ${e.roll}) wird entfernt und zum Korrigieren ins Eingabefeld geladen.`,
    'Zurücknehmen', () => {
      // Ein späteres «wer ist dran» gehört zum zurückgenommenen Zug und fällt mit weg.
      s.log = s.log.filter((x, k) => k < i || (k > i && x.t !== 'next'));
      s.ended = false;
      s.view = 'game';
      s.draft = { roll: String(e.roll), stage: 'roll', hits: e.hits };
      save();
      render();
      window.scrollTo(0, 0);
      toast(`Zug von ${nameOf(e.pid)} zurückgenommen`);
    });
}

function editTurn(i) {
  const s = S();
  const e = s.log[i];
  const st = replay(s).steps[i];
  const isStart = st.info.kind === 'start';
  const askHits = roll => {
    const x = roll - LIMIT;
    numberModal({
      title: `Bonuswurf auf ${FACE_NAME[x]}`,
      text: `Wie viele ${FACE_NAME[x]} wurden insgesamt herausgelegt (0–6)?`,
      sub: e.hits != null ? `bisher ${e.hits}` : '',
      maxLen: 1,
      onOk(v) {
        const h = parseInt(v, 10);
        if (!(h >= 0 && h <= 6)) return toast('Bitte 0 bis 6 eingeben');
        Object.assign(e, { roll, hits: h });
        ui.modal = null; save(); render();
      },
    });
  };
  numberModal({
    title: `Zug von ${nameOf(e.pid)} ändern`,
    text: 'Augensumme dieses Wurfs. Alles Spätere wird neu berechnet.',
    sub: `bisher ${e.roll}${e.hits != null ? ` · Bonus ${e.hits} Treffer` : ''}`,
    maxLen: 2,
    onOk(v) {
      const roll = parseInt(v, 10);
      if (!validRoll(roll)) return toast('Mit 6 Würfeln gibt es 6 bis 36 Augen');
      if (!isStart && roll > LIMIT) return askHits(roll);
      Object.assign(e, { roll, hits: null });
      ui.modal = null; save(); render();
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
    text: 'Stand dieser Korrektur ändern.',
    sub: `bisher ${e.value}`,
    maxLen: 3,
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
  const r = replay(s);
  const isOut = !r.alive(id);
  const now = r.score[id];
  numberModal({
    title: `${nameOf(id)} korrigieren`,
    text: isOut
      ? `${esc(nameOf(id))} ist raus. Mit einem neuen Stand kommt ${esc(nameOf(id))} wieder ins Spiel.`
      : 'Neuen Stand eingeben. Die Korrektur erscheint im Verlauf.',
    sub: isOut ? 'ausgeschieden' : `aktuell ${now}`,
    maxLen: 3,
    onOk(v) {
      if (v === '') return toast('Bitte neuen Stand eingeben');
      const value = parseInt(v, 10);
      ui.modal = null;
      if (isOut || value !== now) {
        s.log.push({ t: 'set', pid: id, value, ts: Date.now() });
        s.ended = false;
        save();
        toast(isOut ? `${nameOf(id)} ist wieder im Spiel (${value})` : `${nameOf(id)}: ${now} → ${value}`);
      }
      render();
    },
    extra: isOut ? [] : [{
      label: 'Aus dem Spiel nehmen', cls: 'danger',
      fn: () => confirmModal(`${nameOf(id)} rausnehmen?`, `${nameOf(id)} scheidet aus und wird übersprungen.`, 'Rausnehmen', () => {
        s.log.push({ t: 'out', pid: id, ts: Date.now() });
        save(); render();
      }),
    }],
  });
}

function newGame() {
  const s = S();
  const doIt = () => { resetGame(ID); save(); render(); window.scrollTo(0, 0); };
  if (s.phase === 'game' && !replay(s).over && (s.log.length || s.draft.roll)) {
    confirmModal('Neues Spiel starten?', 'Der aktuelle Spielstand geht verloren. Spieler und Sitzordnung bleiben erhalten.', 'Neues Spiel', doIt);
  } else doIt();
}

function act(s, a, el) {
  const { id, i } = el.dataset;
  switch (a) {
    case 'start': return startGame();
    case 'back-game': return show(s, 'game');
    case 'history': ui.modal = null; return show(s, 'history');
    case 'undo': ui.modal = null; return undoTurn();
    case 'correct': return correctPlayer(id);
    case 'edit-turn': return editTurn(Number(i));
    case 'edit-set': return editSet(Number(i));
    case 'edit-out':
      return confirmModal('Korrektur löschen?', `${nameOf(s.log[Number(i)].pid)} kommt wieder ins Spiel.`, 'Löschen', () => {
        s.log.splice(Number(i), 1); save(); render();
      });
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
  if (s.view !== 'game') return;
  const r = replay(s);
  if (r.over || !r.cur) return;
  const d = s.draft;

  if (d.stage === 'hits') {
    const x = parseInt(d.roll, 10) - LIMIT;
    if (k.startsWith('hits:') || /^[0-6]$/.test(k)) d.hits = Number(k.replace('hits:', ''));
    else if (k === 'roll-back' || k === 'back' || k === 'clear') d.stage = 'roll';
    else if (k === 'go') {
      if (d.hits == null) return toast(`Wie viele ${FACE_NAME[x]}?`);
      return saveTurn();
    } else return;
    save();
    return render();
  }

  if (k === 'go') {
    const roll = parseInt(d.roll, 10);
    if (!validRoll(roll)) return toast('Mit 6 Würfeln gibt es 6 bis 36 Augen');
    if (r.started.has(r.cur) && roll > LIMIT) {
      d.stage = 'hits';
      save();
      return render();
    }
    return saveTurn();
  }
  d.roll = applyKey(d.roll, k, { maxLen: 2 });
  if (d.hits != null && !(parseInt(d.roll, 10) > LIMIT)) d.hits = null;
  save();
  render();
}

const RULES = `
  <h2>Ziel</h2>
  <p>Wer als <b>Letzter noch im Spiel</b> ist, gewinnt.</p>

  <h2>Wer beginnt?</h2>
  <p>Zuerst würfelt jeder einmal. Wer am höchsten hat, beginnt. Danach geht es reihum
  <b>gegen den Uhrzeigersinn</b>. Der <b>Vorgänger</b> ist die Person, die direkt vor einem dran war.</p>

  <h2>Startrunde</h2>
  <p>In der ersten Runde würfelt jeder mit <b>allen 6 Würfeln</b>. Die Augensumme ist der Startstand.</p>

  <h2>Ab der zweiten Runde</h2>
  <p>Jeder würfelt mit allen 6 Würfeln. Entscheidend ist die Augensumme:</p>
  <table class="plain">
    <tr><td>unter 30</td><td>Differenz bei sich abziehen</td></tr>
    <tr><td>genau 30</td><td>nichts passiert</td></tr>
    <tr><td>über 30</td><td>Überschuss bei sich dazuzählen + Bonuswurf</td></tr>
  </table>

  <h2>Bonuswurf (über 30)</h2>
  <ul>
    <li>Der Überschuss bestimmt die Augenzahl, auf die man würfelt: 31 → ${FACE[1]} Einer, 32 → ${FACE[2]} Zweier,
      … 36 → ${FACE[6]} Sechser.</li>
    <li>Man würfelt mit allen 6 Würfeln und legt die Treffer heraus. Solange mindestens ein Treffer dabei war,
      darf man mit den übrigen Würfeln weiterwürfeln.</li>
    <li>Die <b>Augensumme der Treffer</b> wird dem <b>Vorgänger</b> abgezogen.</li>
    <li>Kann der Vorgänger nicht alles tragen (er fällt auf 0), geht der <b>Rest weiter</b> an den Vorvorgänger usw.
      Sind alle anderen auf 0 – zum Beispiel, wenn man nur noch zu zweit ist –, zieht man den Rest bei sich selbst ab.</li>
  </ul>
  <p class="ex">Beispiel: Anna steht auf 25 und würfelt 32 → Anna +2 = 27. Im Bonuswurf auf Zweier kommen insgesamt
  drei Zweier → 3 × 2 = 6 werden Annas Vorgänger abgezogen.</p>

  <h2>Auf 0 – retten oder raus</h2>
  <p>Wer auf 0 fällt, kann sich im nächsten Zug retten: Mit <b>über 30</b> geht es normal weiter
  (Überschuss dazu und Bonuswurf). Mit <b>30 oder weniger</b> ist man <b>raus</b>.</p>

  <h2>So funktioniert die App</h2>
  <ul>
    <li>Spieler in Sitzordnung <b>gegen den Uhrzeigersinn</b> eintragen und mit 🎲 wählen, wer beginnt.</li>
    <li>Für jeden Zug die <b>Augensumme</b> eingeben. Bei über 30 fragt die App nach den Treffern im Bonuswurf
      und zeigt gleich an, wem wie viel abgezogen wird.</li>
    <li>Die App rechnet alles selbst: Startstand, Abzüge, Weitergeben an den Vorvorgänger, Rettung und Ausscheiden.</li>
    <li>Im <b>Verlauf</b> lässt sich jeder Zug ändern oder löschen, <b>↶ Zug</b> nimmt den letzten Zug zurück.
      Einen Spieler antippen, um seinen Stand zu korrigieren oder ihn aus dem Spiel zu nehmen.</li>
  </ul>`;

export default {
  id: ID,
  title: 'Sterbslen',
  tagline: '6 Würfel rund um die 30 – wer übrig bleibt, gewinnt',
  badge: BADGE,
  mark: { emoji: '🎲', first: 'beginnt', now: 'ist dran', verb: 'würfelt' },
  rules: RULES,
  fresh,
  status(s) {
    if (s.phase === 'setup') return null;
    const r = replay(s);
    if (r.over) return `Beendet · gewonnen hat ${ranking(s, r)[0].name}`;
    const alive = s.players.filter(p => r.alive(p.id)).length;
    return `Läuft · ${nameOf(r.cur)} würfelt · ${alive} von ${s.players.length} im Spiel`;
  },
  render(s) {
    if (s.phase === 'setup') {
      return setupScreen(this, s, {
        hint: 'Zuerst würfelt jeder einmal – wer am höchsten hat, beginnt. Reihenfolge <b>gegen den Uhrzeigersinn</b> eintragen und mit 🎲 festlegen, wer beginnt.',
      });
    }
    if (s.view === 'history') return renderHistory();
    if (replay(s).over) return renderOver();
    return renderGame();
  },
  modal(s, m) {
    if (m.type !== 'out') return '';
    const r = replay(s);
    return `<div class="celebrate">💀</div>
      <h2>${esc(nameOf(m.pid))} ist raus</h2>
      <p>Rettungswurf ${m.roll} – nicht über 30. Das ist Platz ${m.place}.
      ${r.over ? 'Damit ist das Spiel fertig.' : `Weiter geht es mit <b>${esc(nameOf(r.cur))}</b>.`}</p>
      <button class="btn primary" data-act="modal-close">Weiter</button>
      <button class="btn ghost small" data-act="undo">Zug zurücknehmen</button>`;
  },
  menu(s) {
    return [
      { label: 'Reihenfolge, Namen & wer dran ist', act: 'order' },
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
    return last ? nextAfter(players, last.pid, r.alive) : null;
  },
  orderSave(s, players, next) {
    if (!replay(s).alive(next)) return 'Wer raus ist, würfelt nicht mehr';
    s.players = players;
    if (replay(s).cur !== next) s.log.push({ t: 'next', pid: next, ts: Date.now() });
    return null;
  },
  act,
  key,
};
