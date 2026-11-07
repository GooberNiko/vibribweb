// Keyboard and gamepad. The four roads: Block (L1), Pit (down), Loop (R1), Wave (cross).
import { B_BLOCK, B_PIT, B_LOOP, B_WAVE } from './gameplay.js';

export const DEFAULT_KEYS = {
  block: ['ArrowLeft', 'KeyA'],
  pit: ['ArrowDown', 'KeyS'],
  loop: ['ArrowRight', 'KeyD'],
  wave: ['ArrowUp', 'KeyW', 'Space'],
};
const BITS = { block: B_BLOCK, pit: B_PIT, loop: B_LOOP, wave: B_WAVE };
// standard gamepad mapping: L1/L2 block, d-pad up/down pit, R1/R2 loop, cross/triangle wave
const PAD = [[4, B_BLOCK], [6, B_BLOCK], [12, B_PIT], [13, B_PIT], [5, B_LOOP], [7, B_LOOP], [0, B_WAVE], [3, B_WAVE]];

export class Input {
  constructor() {
    this.keys = structuredClone(DEFAULT_KEYS);
    this.pressed = 0;
    this.padHeld = new Set();
    this.held = {};
    this.onStart = null;
    this.active = () => true; // whether the game, not a menu, has the keys
    window.addEventListener('keydown', e => {
      if (e.repeat || !this.active()) return;
      for (const [road, codes] of Object.entries(this.keys)) {
        if (codes.includes(e.code)) { this.pressed |= BITS[road]; e.preventDefault(); }
      }
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.onStart) { e.preventDefault(); e.stopImmediatePropagation(); this.onStart(e.code); }
    });
    // the game's menus
    this.titleActive = () => false;
    this.onTitleKey = null;
    const TITLE_KEYS = {
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      Enter: 'confirm', Space: 'confirm', KeyZ: 'confirm', Escape: 'back', Backspace: 'back', KeyX: 'back',
    };
    window.addEventListener('keydown', e => {
      if (!this.titleActive() || !TITLE_KEYS[e.code]) return;
      if (e.target && e.target.closest && e.target.closest('button, input, select')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat && (TITLE_KEYS[e.code] === 'confirm' || TITLE_KEYS[e.code] === 'back')) return;
      this.onTitleKey && this.onTitleKey(TITLE_KEYS[e.code]);
    });
    // HTML panels: up and down move between the buttons shown
    window.addEventListener('keydown', e => {
      if (this.active()) return;
      if (e.code === 'Escape' && this.onStart) { this.onStart(e.code); return; }
      if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
      const buttons = [...document.querySelectorAll('.panel:not([hidden]) button:not(:disabled)')];
      if (!buttons.length) return;
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement);
      const n = e.code === 'ArrowDown' ? (i + 1) % buttons.length : (i <= 0 ? buttons.length - 1 : i - 1);
      buttons[n].focus();
    });
  }
  // the roads pressed since the last call
  take() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const now = performance.now();
    for (const pad of pads) {
      if (!pad) continue;
      if (this.titleActive()) {
        // the menus: d-pad (repeating while held), cross to choose, circle or triangle to go back
        const map = [[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'], [0, 'confirm'], [1, 'back'], [3, 'back']];
        for (const [btn, key] of map) {
          const id = pad.index + ':t' + btn;
          const down = pad.buttons[btn] && pad.buttons[btn].pressed;
          if (down) {
            const t0 = this.held[id];
            if (t0 === undefined) { this.held[id] = now; this.onTitleKey && this.onTitleKey(key); }
            else if (btn >= 12 && now - t0 > 400) { this.held[id] = now - 300; this.onTitleKey && this.onTitleKey(key); }
          } else delete this.held[id];
        }
        continue;
      }
      for (const [btn, bit] of PAD) {
        const id = pad.index + ':' + btn;
        const down = pad.buttons[btn] && pad.buttons[btn].pressed;
        if (down && !this.padHeld.has(id)) { this.padHeld.add(id); this.pressed |= bit; }
        else if (!down) this.padHeld.delete(id);
      }
      const sid = pad.index + ':9';
      if (pad.buttons[9] && pad.buttons[9].pressed) {
        if (!this.padHeld.has(sid)) { this.padHeld.add(sid); this.onStart && this.onStart('Start'); }
      } else this.padHeld.delete(sid);
    }
    const p = this.pressed;
    this.pressed = 0;
    return p;
  }
}
