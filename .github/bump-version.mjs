// Erhöht die Patch-Version (1.1.0 → 1.1.1) überall, wo sie steht. Läuft in .github/workflows/version.yml.
// Von Hand für eine neue Minor-/Major-Version: node .github/bump-version.mjs 1.2.0
import { readFileSync, writeFileSync } from 'node:fs';

const PKG = 'api/package.json';
const LOCK = 'api/package-lock.json';
const CORE = 'frontend/js/core.js';

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const next = process.argv[2] || `${major}.${minor}.${patch + 1}`;
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`Ungültige Version: ${next}`);

// Nur die Zeile ändern, damit der Rest der Datei bleibt, wie er ist.
writeFileSync(PKG, readFileSync(PKG, 'utf8').replace(/"version": "[^"]+"/, `"version": "${next}"`));

const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
lock.version = next;
lock.packages[''].version = next;
writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);

const core = readFileSync(CORE, 'utf8');
const re = /export const VERSION = '[^']+'/;
if (!re.test(core)) throw new Error(`VERSION nicht gefunden in ${CORE}`);
writeFileSync(CORE, core.replace(re, `export const VERSION = '${next}'`));

console.log(next);
