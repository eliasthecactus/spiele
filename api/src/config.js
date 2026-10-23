// Einstellungen aus Umgebungsvariablen.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.PORT) || 3000;

// Öffentliche Adresse der App, z.B. https://spiele.example.ch. Passkeys sind an diese Domain gebunden.
const url = new URL(process.env.APP_URL || `http://localhost:${PORT}`);
export const ORIGIN = url.origin;
export const RP_ID = url.hostname;
export const SECURE = url.protocol === 'https:';

// Schlüssel zum Signieren der Sitzungen. Ohne SECRET gilt ein zufälliger, dann ist nach jedem Neustart jeder abgemeldet.
export const SECRET = process.env.SECRET || randomBytes(32).toString('hex');
export const SECRET_MISSING = !process.env.SECRET;

export const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', 'data');
export const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(here, '..', '..', 'frontend');

export const RP_NAME = 'Spiele';
