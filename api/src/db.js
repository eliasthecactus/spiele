// SQLite-Datenbank: Konten, Passkeys, abgeschlossene Spiele (für die Statistik) und laufende Spielstände.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'spiele.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id      TEXT PRIMARY KEY,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credentials (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter    INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    created    INTEGER NOT NULL,
    last_used  INTEGER
  );
  CREATE INDEX IF NOT EXISTS credentials_user ON credentials(user_id);
  CREATE TABLE IF NOT EXISTS games (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id      TEXT NOT NULL,
    data    TEXT NOT NULL,
    updated INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  -- Laufender Spielstand pro Spiel (uno, zehntausend, …), damit er auf einem anderen Gerät weitergeht.
  CREATE TABLE IF NOT EXISTS live (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot    TEXT NOT NULL,
    data    TEXT NOT NULL,
    at      INTEGER NOT NULL,
    PRIMARY KEY (user_id, slot)
  );
`);

const q = {
  user: db.prepare('SELECT id, created FROM users WHERE id = ?'),
  addUser: db.prepare('INSERT INTO users (id, created) VALUES (?, ?)'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  credential: db.prepare('SELECT * FROM credentials WHERE id = ?'),
  credentialsOf: db.prepare('SELECT * FROM credentials WHERE user_id = ?'),
  addCredential: db.prepare(`INSERT INTO credentials (id, user_id, public_key, counter, transports, created)
    VALUES (?, ?, ?, ?, ?, ?)`),
  useCredential: db.prepare('UPDATE credentials SET counter = ?, last_used = ? WHERE id = ?'),
  games: db.prepare('SELECT data FROM games WHERE user_id = ?'),
  countGames: db.prepare('SELECT COUNT(*) AS n FROM games WHERE user_id = ?'),
  upsertGame: db.prepare(`INSERT INTO games (user_id, id, data, updated) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated`),
  deleteGame: db.prepare('DELETE FROM games WHERE user_id = ? AND id = ?'),
  live: db.prepare('SELECT slot, at, data FROM live WHERE user_id = ?'),
  // Die neuere Änderung gewinnt.
  upsertLive: db.prepare(`INSERT INTO live (user_id, slot, data, at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, slot) DO UPDATE SET data = excluded.data, at = excluded.at WHERE excluded.at > live.at`),
};

const toCredential = row => row && {
  id: row.id,
  userId: row.user_id,
  publicKey: new Uint8Array(row.public_key),
  counter: row.counter,
  transports: row.transports ? JSON.parse(row.transports) : undefined,
};

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const getUser = id => q.user.get(id);

export function createUser(userId, cred) {
  tx(() => {
    q.addUser.run(userId, Date.now());
    q.addCredential.run(cred.id, userId, cred.publicKey, cred.counter,
      cred.transports ? JSON.stringify(cred.transports) : null, Date.now());
  });
}

export const deleteUser = id => q.deleteUser.run(id);
export const getCredential = id => toCredential(q.credential.get(id));
export const credentialsOf = userId => q.credentialsOf.all(userId).map(toCredential);
export const useCredential = (id, counter) => q.useCredential.run(counter, Date.now(), id);

export const listGames = userId => q.games.all(userId).map(r => JSON.parse(r.data));
export const countGames = userId => q.countGames.get(userId).n;

export const listLive = userId => q.live.all(userId).map(r => ({ slot: r.slot, at: r.at, state: JSON.parse(r.data) }));

export function applySync(userId, upsert, remove, live = []) {
  tx(() => {
    const now = Date.now();
    for (const g of upsert) q.upsertGame.run(userId, g.id, JSON.stringify(g), now);
    for (const id of remove) q.deleteGame.run(userId, id);
    // Eine vorgehende Uhr soll nicht für immer gewinnen.
    for (const l of live) q.upsertLive.run(userId, l.slot, JSON.stringify(l.state), Math.min(l.at, now + 60000));
  });
}
