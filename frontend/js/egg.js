/*
 * Osterei: Siebenmal schnell auf die Version tippen, dann regnet es Würfel.
 */
import { toast } from './core.js';

const TAPS = 7;
const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const SAYINGS = [
  'Glück im Spiel, Pech beim Abwaschen.',
  'Wer mischt, hat die Macht.',
  'Der Würfel ist rund. Fast.',
  'UNO vergessen ist menschlich. Zwei Karten ziehen auch.',
  'Wer zählt, gewinnt nicht immer. Aber er weiss es zuerst.',
  'Die Punkte stimmen. Die App hat nachgerechnet.',
  'Nur noch ein Spiel. Ehrlich.',
];

let taps = 0;
let last = 0;

function rain() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'dice-rain';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 36; i++) {
    const d = document.createElement('span');
    d.textContent = FACES[Math.floor(Math.random() * FACES.length)];
    d.style.left = `${Math.random() * 100}%`;
    d.style.fontSize = `${24 + Math.random() * 28}px`;
    d.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    d.style.animationDelay = `${Math.random() * 0.8}s`;
    d.style.setProperty('--spin', `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540)}deg`);
    box.appendChild(d);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4500);
}

document.addEventListener('click', e => {
  if (!e.target.closest('[data-act="version"]')) return;
  const now = Date.now();
  taps = now - last < 1500 ? taps + 1 : 1;
  last = now;
  if (taps >= TAPS) {
    taps = 0;
    rain();
    if (navigator.vibrate) { try { navigator.vibrate([30, 40, 30, 40, 60]); } catch { /* ignore */ } }
    toast(`🎲 Würfelmeister! ${SAYINGS[Math.floor(Math.random() * SAYINGS.length)]}`, 4000);
  } else if (taps >= TAPS - 3) {
    toast(`Noch ${TAPS - taps}× …`, 900);
  }
});
