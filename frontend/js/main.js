// Einstieg: Spiele und Seiten anmelden und App starten.
import { registerGame, start } from './core.js';
import uno from './uno.js';
import zehntausend from './zehntausend.js';
import sterbslen from './sterbslen.js';
import './stats.js';
import './account.js';

registerGame(uno);
registerGame(zehntausend);
registerGame(sterbslen);
start();
