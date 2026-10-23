// Einstellungen aus Umgebungsvariablen.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.PORT) || 3000;

// Öffentliche Adresse der App, z.B. https://spiele.example.ch. Passkeys sind an diese Domain gebunden.
// Ohne https:// davor wird https angenommen; Anführungszeichen und Schrägstriche am Ende stören nicht.
function appUrl() {
  let raw = (process.env.APP_URL || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!raw) return new URL(`http://localhost:${PORT}`);
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    return new URL(raw);
  } catch {
    console.error(`APP_URL ist ungültig: «${process.env.APP_URL}». Erwartet z.B. https://spiele.example.ch`);
    process.exit(1);
  }
}
const url = appUrl();
export const ORIGIN = url.origin;
export const RP_ID = url.hostname;
export const SECURE = url.protocol === 'https:';

// Schlüssel zum Signieren der Sitzungen. Ohne SECRET gilt ein zufälliger, dann ist nach jedem Neustart jeder abgemeldet.
export const SECRET = process.env.SECRET || randomBytes(32).toString('hex');
export const SECRET_MISSING = !process.env.SECRET;

export const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', 'data');
export const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(here, '..', '..', 'frontend');

export const RP_NAME = 'Spiele';
