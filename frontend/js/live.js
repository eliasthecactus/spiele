/*
 * Laufende Spiele auf mehreren Geräten: Mit Konto geht jeder begonnene Spielstand beim Abgleich
 * (account.js) mit zum Server und lässt sich auf einem anderen Gerät weiterspielen.
 * Pro Spiel gibt es einen Stand; die neuere Änderung gewinnt.
 *
 * Auf dem Gerät bleiben: die Ansicht (view), halb eingetippte Eingaben (draft) und die
 * Spielerfassung vor dem Start.
 */
import { app, GAMES, ui, onSave, save, render, toast, storageGet, storageSet } from './core.js';

const KEY = 'spiele.live.v1';
const LOCAL = ['view', 'draft'];

function loadMeta() {
  const m = storageGet(KEY);
  if (m && m.v === 1 && m.slots && typeof m.slots === 'object') return m;
  // Pro Spiel { hash, at, dirty, state }: `at` = letzte Änderung, `state` = noch zu übertragender Stand
  return { v: 1, slots: {} };
}

const meta = loadMeta();
const saveMeta = () => storageSet(KEY, meta);

const listeners = [];
/** `fn` läuft, wenn sich ein laufendes Spiel lokal geändert hat. */
export function onLiveChange(fn) { listeners.push(fn); }

const started = s => s && s.phase !== 'setup' && s.gid;

function shared(s) {
  const out = { ...s };
  LOCAL.forEach(k => delete out[k]);
  return out;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return `${h}:${str.length}`;
}

onSave(() => {
  let any = false;
  for (const id in GAMES) {
    const s = app.games[id];
    if (!started(s)) continue;
    const state = shared(s);
    const h = hash(JSON.stringify(state));
    const m = meta.slots[id];
    if (m && m.hash === h) continue;
    // Ein Spiel von vor dieser Funktion zählt ab seinem Start, damit es kein neueres Spiel eines anderen Geräts verdrängt.
    const at = m ? Math.max(Date.now(), m.at + 1) : s.startedAt || Date.now();
    meta.slots[id] = { hash: h, at, dirty: true, state };
    any = true;
  }
  if (any) {
    saveMeta();
    listeners.forEach(fn => fn());
  }
});

export const livePending = () => Object.values(meta.slots).filter(m => m.dirty).length;

/** Was zum Server soll: [{ slot, at, state, hash }]. */
export function liveOutgoing() {
  return Object.entries(meta.slots)
    .filter(([id, m]) => m.dirty && m.state && GAMES[id])
    .map(([id, m]) => ({ slot: id, at: m.at, state: m.state, hash: m.hash }));
}

/** Nach dem Abgleich: Übertragenes abhaken und neuere Stände anderer Geräte übernehmen. */
export function liveApply(list, sent) {
  for (const x of sent) {
    const m = meta.slots[x.slot];
    if (m && m.hash === x.hash) { m.dirty = false; delete m.state; }
  }
  const taken = [];
  for (const { slot, at, state } of list || []) {
    const mod = GAMES[slot];
    const m = meta.slots[slot];
    if (!mod || (m && m.at >= at)) continue;
    const h = hash(JSON.stringify(state));
    const s = app.games[slot];
    if (started(s) && hash(JSON.stringify(shared(s))) === h) {
      meta.slots[slot] = { hash: h, at, dirty: false };
      continue;
    }
    // Im selben Objekt ersetzen, damit offene Verweise (z.B. in Modalen) nicht ins Leere zeigen.
    const base = mod.fresh(null);
    const t = s || (app.games[slot] = {});
    Object.keys(t).forEach(k => delete t[k]);
    Object.assign(t, state, Object.fromEntries(LOCAL.map(k => [k, base[k]])));
    meta.slots[slot] = { hash: h, at, dirty: false };
    taken.push(slot);
  }
  saveMeta();
  if (!taken.length) return;
  save();
  if (taken.includes(app.screen)) {
    ui.modal = null;
    render();
    toast('Spielstand vom anderen Gerät übernommen', 3000);
  }
}
