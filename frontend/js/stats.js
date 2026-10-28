/*
 * Statistik: Jedes fertige Spiel wird mit seiner Rangliste festgehalten.
 * Daraus entstehen Rangliste, Gruppen (wer zusammen gespielt hat), Duelle und Rekorde.
 *
 * Gespeichert wird lokal unter einem eigenen Schlüssel. Mit Konto gleicht account.js
 * die Spiele mit dem Server ab: `dirty` = noch nicht übertragen, `removed` = dort noch zu löschen.
 *
 * Ein Spiel { id, game, start, end, rounds, players: [{ name, place, score, … }] }
 * kommt aus mod.result() des jeweiligen Spiels. Spieler werden über den Namen erkannt.
 */
import {
  app, GAMES, ui, registerPage, onSave, save, render, toast, esc, fmt, uid, topbar, confirmModal,
  storageGet, storageSet,
} from './core.js';

const KEY = 'spiele.stats.v1';
const PAGE = 20;
const BADGE = '<span class="logo home">📊</span>';

function loadStore() {
  const s = storageGet(KEY);
  if (s && s.v === 1 && Array.isArray(s.games)) return s;
  return { v: 1, games: [], dirty: {}, removed: [], ignored: [], rev: 0, lastSync: null };
}

export const store = loadStore();

const listeners = [];
/** `fn` läuft, wenn sich die Statistik lokal geändert hat (für den Abgleich mit dem Konto). */
export function onStatsChange(fn) { listeners.push(fn); }

export function saveStore() { storageSet(KEY, store); }

function changed() {
  saveStore();
  listeners.forEach(fn => fn());
}

if (!app.statsUi) app.statsUi = { game: 'all', group: null, player: null, limit: PAGE };
const f = () => app.statsUi;

// ---------- Erfassen ----------

function put(rec) {
  const i = store.games.findIndex(g => g.id === rec.id);
  if (i >= 0 && JSON.stringify(store.games[i]) === JSON.stringify(rec)) return false;
  if (i >= 0) store.games[i] = rec; else store.games.push(rec);
  store.dirty[rec.id] = ++store.rev;
  store.removed = store.removed.filter(id => id !== rec.id);
  return true;
}

function drop(id) {
  const i = store.games.findIndex(g => g.id === id);
  if (i < 0) return false;
  store.games.splice(i, 1);
  delete store.dirty[id];
  if (app.account && app.account.loggedIn) store.removed.push(id);
  return true;
}

/** Bei jedem Speichern: fertige Spiele übernehmen, wieder geöffnete (z.B. ↶) herausnehmen. */
onSave(() => {
  let any = false;
  for (const id in GAMES) {
    const s = app.games[id];
    if (!s || s.phase === 'setup' || !GAMES[id].result) continue;
    if (!s.gid) s.gid = uid(); // Spiele, die vor der Statistik begonnen wurden
    if (store.ignored.includes(s.gid) || s.noStats) continue;
    const res = GAMES[id].result(s);
    any = (res ? put({ id: s.gid, game: id, start: s.startedAt || res.end, ...res }) : drop(s.gid)) || any;
  }
  if (any) changed();
});

function deleteGame(id) {
  drop(id);
  store.ignored = [...store.ignored, id].slice(-500); // damit ein noch offenes Spiel nicht wieder auftaucht
  // Auch auf anderen Geräten, die diesen Spielstand übernehmen, soll es nicht wieder auftauchen.
  const open = Object.values(app.games).find(s => s.gid === id);
  if (open) { open.noStats = true; save(); }
  changed();
}

/** Beim Abmelden: was im Konto liegt, verschwindet von diesem Gerät. Nicht Übertragenes bleibt. */
export function forgetAccountData({ all = false } = {}) {
  const gone = store.games.filter(g => all || !store.dirty[g.id]).map(g => g.id);
  // Ein noch angezeigtes, fertiges Spiel soll beim nächsten Speichern nicht wieder auftauchen.
  const open = Object.values(app.games).map(s => s.gid).filter(id => gone.includes(id));
  store.ignored = [...store.ignored, ...open].slice(-500);
  store.games = store.games.filter(g => !gone.includes(g.id));
  if (all) store.dirty = {};
  store.removed = [];
  store.lastSync = null;
  saveStore();
}

// ---------- Auswerten ----------

const pkey = name => String(name).trim().toLocaleLowerCase('de-CH');
const groupKey = g => g.players.map(p => pkey(p.name)).sort().join('|');
const known = g => GAMES[g.game];
const newestFirst = list => [...list].sort((a, b) => b.end - a.end);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const date = ts => new Date(ts).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' });
const dateTime = ts => new Date(ts).toLocaleString('de-CH', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const winners = g => g.players.filter(p => p.place === 1);
const avg = (list, fn) => list.reduce((a, x) => a + fn(x), 0) / list.length;

/** Alle Spiele nach Spiel- und Gruppenfilter. */
function filtered() {
  return store.games.filter(g => known(g)
    && (f().game === 'all' || g.game === f().game)
    && (!f().group || groupKey(g) === f().group));
}

/** Rangliste: pro Spieler Spiele, Siege, Quote und Ø Platz. */
function leaderboard(games) {
  const by = new Map();
  for (const g of [...games].sort((a, b) => a.end - b.end)) {
    for (const p of g.players) {
      const k = pkey(p.name);
      const e = by.get(k) || { key: k, name: p.name, played: 0, wins: 0, places: 0 };
      e.name = p.name; // neueste Schreibweise
      e.played++;
      e.places += p.place;
      if (p.place === 1) e.wins++;
      by.set(k, e);
    }
  }
  return [...by.values()].sort((a, b) => b.wins - a.wins
    || b.wins / b.played - a.wins / a.played || b.played - a.played || a.name.localeCompare(b.name));
}

/** Gruppen = genau dieselben Mitspieler. */
function groups(games) {
  const by = new Map();
  for (const g of newestFirst(games)) {
    const k = groupKey(g);
    const e = by.get(k) || { key: k, names: g.players.map(p => p.name), games: [] };
    e.games.push(g);
    by.set(k, e);
  }
  return [...by.values()]
    .map(e => ({ ...e, top: leaderboard(e.games)[0] }))
    .sort((a, b) => b.games.length - a.games.length || b.games[0].end - a.games[0].end);
}

/** Direktvergleich: wie oft lag `key` vor bzw. hinter jedem anderen. */
function duels(games, key) {
  const by = new Map();
  for (const g of newestFirst(games)) {
    const me = g.players.find(p => pkey(p.name) === key);
    if (!me) continue;
    for (const o of g.players) {
      const k = pkey(o.name);
      if (k === key) continue;
      const e = by.get(k) || { name: o.name, ahead: 0, behind: 0, games: 0 };
      e.games++;
      if (me.place < o.place) e.ahead++;
      else if (me.place > o.place) e.behind++;
      by.set(k, e);
    }
  }
  return [...by.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

function groupLabel(key) {
  const gr = groups(store.games.filter(known)).find(x => x.key === key);
  return gr ? gr.names.join(', ') : 'Gruppe';
}

// ---------- Bausteine ----------

function filterBar() {
  const used = new Set(store.games.map(g => g.game));
  const ids = Object.keys(GAMES).filter(id => used.has(id));
  if (!ids.length) return '';
  const chip = (id, label) => `<button class="chip ${f().game === id ? 'on' : ''}" data-act="stat-filter" data-id="${id}">${esc(label)}</button>`;
  return `<div class="chips">${chip('all', 'Alle')}${ids.map(id => chip(id, GAMES[id].title)).join('')}</div>
    <button class="field" data-act="stat-groups">
      <span>Gruppe</span><span class="val small">${f().group ? esc(groupLabel(f().group)) : 'Alle'} ›</span></button>`;
}

function tiles(list) {
  return `<div class="tiles">${list.map(([label, value]) => `<div class="tile"><b>${value}</b><span>${esc(label)}</span></div>`).join('')}</div>`;
}

function gameRow(g) {
  const mod = GAMES[g.game];
  const w = winners(g);
  return `<button class="grow t-${g.game}" data-act="stat-game" data-id="${g.id}">
    ${mod.badge}
    <span class="gtext"><b>🏆 ${w.map(p => esc(p.name)).join(' & ')}</b>
      <small>${g.players.map(p => esc(p.name)).join(', ')}</small></span>
    <span class="gdate">${date(g.end)}</span>
  </button>`;
}

function gameList(games, limit) {
  const list = newestFirst(games);
  return `<div class="glist">${list.slice(0, limit).map(gameRow).join('')}</div>
    ${list.length > limit ? `<button class="btn ghost small" data-act="stat-more">Mehr anzeigen (${list.length - limit})</button>` : ''}`;
}

function syncLine() {
  if (app.account && app.account.loggedIn) {
    const pending = Object.keys(store.dirty).length + store.removed.length;
    return `<p class="hint">☁️ ${pending ? 'Wird mit deinem Konto abgeglichen …' : 'In deinem Konto gesichert.'}</p>`;
  }
  return `<button class="note-btn" data-act="open-page" data-id="account">
    Die Statistik liegt nur auf diesem Gerät. <b>Mit Passkey sichern ›</b></button>`;
}

// ---------- Screens ----------

function renderOverview() {
  const games = filtered();
  const board = leaderboard(games);
  const mod = GAMES[f().game];
  const head = `${topbar('Statistik', { back: 'home', badge: BADGE })}<div class="content">${syncLine()}${filterBar()}`;
  if (!games.length) {
    return `${head}<div class="empty-state">${store.games.length
      ? 'Für diese Auswahl gibt es noch keine Spiele.'
      : 'Noch keine fertigen Spiele.<br>Sobald ein Spiel beendet ist, erscheint es hier.'}</div></div>`;
  }
  const first = Math.min(...games.map(g => g.end));
  const recs = mod && mod.records ? mod.records(games) : [];
  const grs = f().group ? [] : groups(games).filter(x => x.games.length > 1 || games.length <= 5).slice(0, 5);
  return `${head}
    ${tiles([['Spiele', fmt(games.length)], ['Spieler', fmt(board.length)], ['seit', date(first)]])}
    <div class="section-title">Rangliste · Siege</div>
    <ol class="standings">${board.map((p, i) => {
      const prev = board[i - 1];
      const rank = prev && prev.wins === p.wins && prev.played === p.played ? '' : i + 1;
      return `<li><button data-act="stat-player" data-id="${esc(p.key)}">
        <span class="rank">${rank}</span>
        <span class="pname">${esc(p.name)}</span>
        <span class="pts">${p.wins}</span>
        <span class="bar"><i class="gold" style="width:${pct(p.wins, p.played)}%"></i></span>
        <span class="sub">${pct(p.wins, p.played)}% von ${p.played} ${p.played === 1 ? 'Spiel' : 'Spielen'} · Ø Platz ${(p.places / p.played).toFixed(1)}</span>
      </button></li>`;
    }).join('')}</ol>
    <p class="hint">Tippe auf einen Spieler für Details und Duelle.</p>
    ${recs.length ? `<div class="section-title">Rekorde</div>
      <div class="kv">${recs.map(r => `<button data-act="stat-game" data-id="${r.g.id}"><span>${esc(r.label)}</span>
        <b>${r.value}</b><small>${r.who ? `${esc(r.who)} · ` : ''}${date(r.g.end)}</small></button>`).join('')}</div>` : ''}
    ${grs.length ? `<div class="section-title">Gruppen</div>
      <div class="glist">${grs.map(gr => `<button class="grow" data-act="stat-group" data-id="${esc(gr.key)}">
        <span class="gcount">${gr.games.length}×</span>
        <span class="gtext"><b>${gr.names.map(esc).join(', ')}</b>
          <small>Meiste Siege: ${esc(gr.top.name)} (${gr.top.wins})</small></span>
        <span class="chev">›</span></button>`).join('')}</div>` : ''}
    <div class="section-title">Letzte Spiele</div>
    ${gameList(games, f().limit)}
  </div>`;
}

function renderPlayer() {
  const key = f().player;
  const all = filtered();
  const mine = all.filter(g => g.players.some(p => pkey(p.name) === key));
  if (!mine.length) { f().player = null; return renderOverview(); }
  const me = g => g.players.find(p => pkey(p.name) === key);
  const name = me(newestFirst(mine)[0]).name;
  const wins = mine.filter(g => me(g).place === 1).length;
  const scope = [f().game !== 'all' && GAMES[f().game].title, f().group && groupLabel(f().group)].filter(Boolean);

  const perGame = Object.keys(GAMES).map(id => {
    const list = mine.filter(g => g.game === id);
    if (!list.length) return '';
    const mod = GAMES[id];
    const entries = list.map(g => ({ g, p: me(g) }));
    const w = entries.filter(e => e.p.place === 1).length;
    const extra = mod.playerStats ? mod.playerStats(entries) : [];
    return `<div class="hcard t-${id}"><header><b>${mod.badge} ${esc(mod.title)}</b>
        <span>${w} von ${list.length} gewonnen · ${pct(w, list.length)}%</span></header>
      <table>
        <tr><td>Ø Platz</td><td colspan="2">${avg(entries, e => e.p.place).toFixed(1)}</td></tr>
        ${extra.map(([k, v]) => `<tr><td>${esc(k)}</td><td colspan="2">${v}</td></tr>`).join('')}
      </table></div>`;
  }).join('');

  const ds = duels(mine, key);
  return `${topbar(name, { back: 'stat-back', backLabel: '‹ Zurück', badge: BADGE })}
  <div class="content">
    ${scope.length ? `<p class="hint">Nur ${scope.map(esc).join(' · ')}</p>` : ''}
    ${tiles([['Spiele', fmt(mine.length)], ['Siege', fmt(wins)], ['Quote', `${pct(wins, mine.length)}%`]])}
    ${perGame}
    ${ds.length ? `<div class="section-title">Duelle</div>
      <p class="hint">Wie oft ${esc(name)} vor bzw. hinter jemandem gelandet ist.</p>
      <div class="kv duels">${ds.map(d => `<div><span>gegen ${esc(d.name)}</span>
        <b><i class="win">${d.ahead}</i> : <i class="loss">${d.behind}</i></b>
        <small>${d.games} ${d.games === 1 ? 'Spiel' : 'Spiele'}</small></div>`).join('')}</div>` : ''}
    <div class="section-title">Spiele</div>
    ${gameList(mine, f().limit)}
  </div>`;
}

function gameModal(m) {
  const g = store.games.find(x => x.id === m.id);
  if (!g) return '<h2>Spiel nicht gefunden</h2><button class="btn ghost" data-act="modal-close">Schliessen</button>';
  const mod = GAMES[g.game];
  const list = [...g.players].sort((a, b) => a.place - b.place);
  return `<h2>${mod.badge} ${esc(mod.title)}</h2>
    <p>${dateTime(g.end)} · ${g.rounds} ${g.game === 'uno' ? 'Runden' : 'Züge'}</p>
    <ol class="standings">${list.map(p => `<li><button disabled>
      <span class="rank">${p.place === 1 ? '🏆' : `${p.place}.`}</span>
      <span class="pname">${esc(p.name)}</span><span class="pts">${fmt(p.score)}</span>
      <span class="bar"></span><span class="sub"></span></button></li>`).join('')}</ol>
    <button class="btn danger" data-act="stat-delete" data-id="${g.id}">Aus der Statistik löschen</button>
    <button class="btn ghost" data-act="modal-close">Schliessen</button>`;
}

function groupsModal() {
  const all = groups(store.games.filter(g => known(g) && (f().game === 'all' || g.game === f().game)));
  return `<h2>Gruppe wählen</h2>
    <p>Nur Spiele, bei denen genau diese Leute mitgespielt haben.</p>
    <div class="menu-list">
      <button class="btn ${!f().group ? 'primary' : ''}" data-act="stat-group" data-id="">Alle Spiele</button>
      ${all.map(gr => `<button class="btn ${f().group === gr.key ? 'primary' : ''}" data-act="stat-group" data-id="${esc(gr.key)}">
        ${gr.names.map(esc).join(', ')} <small class="muted">· ${gr.games.length}×</small></button>`).join('')}
      <button class="btn ghost" data-act="modal-close">Schliessen</button>
    </div>`;
}

/** Kurzübersicht auf der Startseite: Anzahl Spiele, wer am meisten gewinnt, zuletzt gespielt. */
function homeCard() {
  const games = store.games.filter(known);
  const head = '<div class="section-title">Statistik</div>';
  if (!games.length) {
    return `${head}<button class="spanel empty" data-act="open-page" data-id="stats">
      <span class="ic">📊</span>
      <span class="gtext"><b>Noch keine fertigen Spiele</b>
        <small>Danach siehst du hier, wer am meisten gewinnt – auch in welcher Runde.</small></span>
      <span class="chev">›</span>
    </button>`;
  }
  const top = leaderboard(games)[0];
  const last = newestFirst(games)[0];
  return `${head}<button class="spanel" data-act="open-page" data-id="stats">
    <span class="sp"><b>${fmt(games.length)}</b><small>${games.length === 1 ? 'Spiel' : 'Spiele'}</small></span>
    <span class="sp"><b>👑 ${esc(top.name)}</b><small>${top.wins} ${top.wins === 1 ? 'Sieg' : 'Siege'}</small></span>
    <span class="sp"><b>${esc(GAMES[last.game].title)}</b><small>zuletzt ${date(last.end)}</small></span>
  </button>`;
}

function act(a, el) {
  const { id } = el.dataset;
  const top = () => { render(); window.scrollTo(0, 0); };
  switch (a) {
    case 'stat-filter': Object.assign(f(), { game: id, group: null, limit: PAGE }); return top();
    case 'stat-groups': ui.modal = { type: 'stat-groups' }; return render();
    case 'stat-group': ui.modal = null; Object.assign(f(), { group: id || null, player: null, limit: PAGE }); return top();
    case 'stat-player': Object.assign(f(), { player: id, limit: PAGE }); return top();
    case 'stat-back': Object.assign(f(), { player: null, limit: PAGE }); return top();
    case 'stat-more': f().limit += PAGE; return render();
    case 'stat-game': ui.modal = { type: 'stat-game', id }; return render();
    case 'stat-delete':
      return confirmModal('Spiel löschen?', 'Das Spiel wird aus der Statistik entfernt – auch im Konto.', 'Löschen', () => {
        deleteGame(id);
        render();
        toast('Spiel gelöscht');
      });
  }
}

/** Filter, die nach Löschen oder Abmelden ins Leere zeigen, zurücksetzen. */
function tidyFilter() {
  if (f().game !== 'all' && !store.games.some(g => g.game === f().game)) f().game = 'all';
  if (f().group && !store.games.some(g => groupKey(g) === f().group)) f().group = null;
}

registerPage({
  id: 'stats',
  render() {
    tidyFilter();
    return f().player ? renderPlayer() : renderOverview();
  },
  modal: m => (m.type === 'stat-game' ? gameModal(m) : m.type === 'stat-groups' ? groupsModal() : ''),
  homeCard,
  act,
});
