// The level editor: a song's timeline with lanes for the obstacles, the road's
// speed, the game's camera shots, breaks, twists of the road and free camera
// keyframes; the scene previewed at the playhead; obstacles tapped in while the
// song plays; the free camera flown with the mouse in the preview.
import { RATE } from './analysis.js';
import {
  ROADS, SHOTS, ROAD_OF_BITS, DEFAULT_SPEED, MIN_SPEED, MAX_SPEED, LevelSource, newLevel, cleanLevel, sortLevel,
  savedLevels, saveLevel, deleteLevel, exportLevel, importLevel, freeCameraAt, speedAt,
} from './level.js';

const LANES = [
  { key: 'parts', name: 'Obstacles', color: '#ff8a5c', h: 34 },
  { key: 'speeds', name: 'Speed', color: '#7ee0a1', h: 56 },
  { key: 'shots', name: 'Camera shots', color: '#9a9aff', h: 28 },
  { key: 'breaks', name: 'Breaks', color: '#e0a64a', h: 22 },
  { key: 'twists', name: 'Twists', color: '#c08cff', h: 22 },
  { key: 'keys', name: 'Free camera', color: '#50c8dc', h: 26 },
];
const OVERVIEW = 22, RULER = 22, WAVE = 40, LABEL = 118;
const KEY_ROADS = { ArrowLeft: 1, KeyA: 1, ArrowDown: 2, KeyS: 2, ArrowRight: 4, KeyD: 4, ArrowUp: 8, KeyW: 8 };
const ROAD_COLORS = ['#ff6b6b', '#5aa9ff', '#5ee08a', '#ffd84a'];
const ROAD_KEYS = ['←', '↓', '→', '↑'];
const SINGLE = ['Block', 'Pit', 'Loop', 'Wave'];
const BITS_OF_ROAD = Object.fromEntries(Object.entries(ROAD_OF_BITS).map(([b, r]) => [r, +b]));
const SHOT_SHORT = { 1: 'B1', 2: 'B2', 3: 'S1', 4: 'S2', 5: 'F1', 6: 'F2', 7: 'F3' };
const round3 = v => Math.round(v * 1000) / 1000;
const fmt = t => `${Math.floor(Math.max(0, t) / 60)}:${(Math.max(0, t) % 60).toFixed(2).padStart(5, '0')}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// the little drawing of a road: a bump, a dip, a loop, a zigzag
function roadGlyph(ctx, r, x, y, s, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
  if (r === 0) { ctx.moveTo(x - s, y + s * 0.6); ctx.lineTo(x - s * 0.5, y + s * 0.6); ctx.lineTo(x - s * 0.5, y - s * 0.6); ctx.lineTo(x + s * 0.5, y - s * 0.6); ctx.lineTo(x + s * 0.5, y + s * 0.6); ctx.lineTo(x + s, y + s * 0.6); }
  else if (r === 1) { ctx.moveTo(x - s, y - s * 0.4); ctx.lineTo(x - s * 0.4, y - s * 0.4); ctx.lineTo(x, y + s * 0.7); ctx.lineTo(x + s * 0.4, y - s * 0.4); ctx.lineTo(x + s, y - s * 0.4); }
  else if (r === 2) { ctx.moveTo(x - s, y + s * 0.7); ctx.lineTo(x + s, y + s * 0.7); ctx.moveTo(x + s * 0.55, y); ctx.arc(x, y, s * 0.55, 0, Math.PI * 2); }
  else { ctx.moveTo(x - s, y); for (let i = 0; i <= 6; i++) ctx.lineTo(x - s + (i + 0.5) * s / 3.5, y + (i % 2 ? s * 0.6 : -s * 0.6)); ctx.lineTo(x + s, y); }
  ctx.stroke();
}
// the same as a small inline picture for the buttons
function glyphSvg(r) {
  const d = ['M1 13 H5 V5 H13 V13 H17', 'M1 7 H6 L9 15 L12 7 H17', 'M1 15 H17 M13 9 A4 4 0 1 1 13 8.9', 'M1 9 L3 5 L6 13 L9 5 L12 13 L15 5 L17 9'][r];
  return `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path d="${d}" fill="none" stroke="${ROAD_COLORS[r]}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export class Editor {
  // `app`: what the editor needs of the game (see main.js)
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('editor');
    this.level = null;
    this.buffer = null;
    this.peaks = null;
    this.t = 0;
    this.playing = false;
    this.view = { start: 0, scale: 80 };
    this.snap = 2;            // divisions of a beat (0: off)
    this.selection = new Set();
    this.undo = []; this.redo = [];
    this.brushBits = 1; this.brushShot = 2;
    this.dirty = true;
    this.lastTap = null;
    this.hover = null;
    this.taps = [];
    this.split = parseFloat(localStorage.getItem('vibrib.editorSplit')) || 0.5;
    this.build();
  }

  // ---------- the page ----------
  build() {
    this.root.innerHTML = `
      <header class="ed-top">
        <button data-act="levels" class="ed-ghost" title="Your levels">☰ Levels</button>
        <input class="ed-name" data-field="name" aria-label="Level name" spellcheck="false">
        <span class="ed-song" data-out="song"></span>
        <div class="ed-transport">
          <button data-act="home" title="To the start (Home)">⏮</button>
          <button data-act="play" class="ed-play" title="Play / pause (Space)">▶</button>
          <span class="ed-time"><b data-out="time">0:00.00</b><small data-out="duration"> / 0:00</small></span>
        </div>
        <span class="ed-status" data-out="status" role="status"></span>
        <div class="ed-actions">
          <button data-act="undo" title="Undo (Ctrl+Z)">↶</button><button data-act="redo" title="Redo (Ctrl+Y)">↷</button>
          <button data-act="export" title="Save as a .vibl file to share">Export</button>
          <button data-act="test-here" title="Play the level from the playhead">▶ From here</button>
          <button data-act="test" class="ed-primary" title="Play the level from the start">▶ Play level</button>
          <button data-act="help" class="ed-ghost" title="Keys (?)">?</button>
          <button data-act="exit" class="ed-ghost" title="Back to the game">✕</button>
        </div>
      </header>
      <div class="ed-preview"><div class="ed-overlay" data-out="overlay"></div></div>
      <div class="ed-split" data-out="split" title="Drag to resize"></div>
      <div class="ed-lower">
        <div class="ed-main">
          <div class="ed-tools">
            <div class="ed-group"><span class="ed-label">Obstacle</span>
              ${SINGLE.map((n, i) => `<button class="ed-road" data-road="${i}" title="${n} (${ROAD_KEYS[i]}). Click a second one quickly for a double">${glyphSvg(i)}<span>${n}</span></button>`).join('')}
            </div>
            <div class="ed-group"><span class="ed-label">Shot</span>
              ${SHOTS.map(s => `<button class="ed-shot" data-shot="${s.id}" title="${s.name}">${SHOT_SHORT[s.id]}</button>`).join('')}
            </div>
            <div class="ed-group">
              <label class="ed-label">Snap <select data-field="snap">
                <option value="0">off</option><option value="1">1 beat</option><option value="2">½</option>
                <option value="3">⅓</option><option value="4">¼</option><option value="8">⅛</option></select></label>
              <label class="ed-label" title="Zoom (Ctrl+wheel)">Zoom <input type="range" data-field="zoom" min="0" max="100"></label>
              <button data-act="fit" title="The whole song">Fit</button>
            </div>
          </div>
          <canvas class="ed-timeline" aria-label="Timeline"></canvas>
        </div>
        <aside class="ed-side" data-out="inspector"></aside>
      </div>
      <div class="ed-help-pop panel menu" data-out="help" hidden>
        <h2>Keys</h2>
        <dl>
          <dt>Space</dt><dd>play / pause</dd>
          <dt>← ↓ → ↑ · A S D W</dt><dd>tap an obstacle at the playhead (two at once: a double)</dd>
          <dt>K</dt><dd>a free camera key from the view now</dd>
          <dt>T</dt><dd>tap the tempo (BPM)</dd>
          <dt>Del</dt><dd>delete the selection</dd>
          <dt>Ctrl+Z · Ctrl+Y</dt><dd>undo · redo</dd>
          <dt>Ctrl+C · Ctrl+V</dt><dd>copy · paste at the playhead</dd>
          <dt>Ctrl+A</dt><dd>select everything</dd>
          <dt>[ ]</dt><dd>nudge the selection by the snap</dd>
          <dt>Home · End</dt><dd>the start · the end</dd>
          <dt>Wheel · Ctrl+wheel</dt><dd>scroll · zoom the timeline</dd>
          <dt>Click · Shift+click · drag</dt><dd>select · add to it · move (drag an empty lane to box-select)</dd>
          <dt>Double-click a lane</dt><dd>add there (Speed: at the height clicked)</dd>
          <dt>A camera key picked</dt><dd>drag the preview to orbit, Shift+drag to pan, wheel to move in, Alt+wheel to zoom</dd>
        </dl>
        <nav class="list row"><button data-act="help">Close</button></nav>
      </div>
      <div class="ed-levels panel menu" data-out="levels" hidden></div>`;
    this.canvas = this.root.querySelector('.ed-timeline');
    this.ctx = this.canvas.getContext('2d');
    this.root.addEventListener('click', e => {
      const road = e.target.closest('[data-road]'); if (road) { this.pickRoad(+road.dataset.road); return; }
      const shot = e.target.closest('[data-shot]'); if (shot) { this.pickShot(+shot.dataset.shot); return; }
      const a = e.target.closest('[data-act]'); if (a) this.act(a.dataset.act, a);
    });
    this.root.addEventListener('change', e => this.field(e.target));
    this.root.addEventListener('input', e => {
      const f = e.target.dataset.field;
      if (f === 'name' || f === 'zoom' || f === 'speedRange' || f === 'baseRange') this.field(e.target, true);
    });
    this.bindSplit();
    this.bindTimeline();
    this.bindPreview();
    window.addEventListener('keydown', e => this.key(e), true);
    window.addEventListener('resize', () => { if (this.active) { this.layout(); this.dirty = true; } });
    this.paintPalette();
  }
  out(name) { return this.root.querySelector(`[data-out="${name}"]`); }

  open() { this.show(); this.showLevels(); }
  // back from playing the level, with how it went
  resume(message) { this.show(); this.status(message, true); this.dirty = true; }
  show() {
    this.root.hidden = false;
    document.body.classList.add('editing');
    this.layout();
  }
  close() {
    this.pause();
    this.root.hidden = true;
    document.body.classList.remove('editing');
    this.app.renderer().resize();
  }
  get active() { return !this.root.hidden; }
  status(text, good = false) {
    const el = this.out('status');
    el.textContent = text || '';
    el.classList.toggle('good', good);
    clearTimeout(this.statusTimer);
    if (text) this.statusTimer = setTimeout(() => { el.textContent = ''; }, 7000);
  }

  // the preview's share of the height, dragged by the split
  layout() {
    document.body.style.setProperty('--ed-split', `${Math.round(this.split * 100)}vh`);
    this.app.renderer().resize();
    this.sizeTimeline();
  }
  bindSplit() {
    const bar = this.out('split');
    bar.addEventListener('pointerdown', e => {
      bar.setPointerCapture(e.pointerId);
      const move = ev => { this.split = clamp(ev.clientY / window.innerHeight, 0.22, 0.75); this.layout(); this.dirty = true; };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); try { localStorage.setItem('vibrib.editorSplit', this.split); } catch { } };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });
  }

  // ---------- the palettes ----------
  // a road for new obstacles (and the ones picked); a second one clicked soon after makes a double
  pickRoad(r) {
    const bit = 1 << r;
    let bits = bit;
    const single = (this.brushBits & (this.brushBits - 1)) === 0;
    if (this.doubling && single && this.brushBits !== bit && ROAD_OF_BITS[this.brushBits | bit] !== undefined) bits = this.brushBits | bit;
    this.brushBits = bits;
    this.doubling = true; clearTimeout(this.doubleTimer); this.doubleTimer = setTimeout(() => { this.doubling = false; }, 900);
    const parts = this.selectedOf('parts');
    if (parts.length) this.edit(() => { for (const p of parts) p.road = ROAD_OF_BITS[bits]; });
    this.paintPalette();
  }
  pickShot(id) {
    this.brushShot = id;
    const shots = this.selectedOf('shots');
    if (shots.length) this.edit(() => { for (const s of shots) s.camera = id; });
    this.paintPalette();
  }
  paintPalette() {
    for (const b of this.root.querySelectorAll('[data-road]')) b.classList.toggle('on', !!(this.brushBits & (1 << +b.dataset.road)));
    for (const b of this.root.querySelectorAll('[data-shot]')) b.classList.toggle('on', +b.dataset.shot === this.brushShot);
  }

  // ---------- the levels: open, new, import ----------
  showLevels(message = '') {
    this.pause();
    const box = this.out('levels');
    const levels = savedLevels();
    const songs = this.app.songChoices();
    box.innerHTML = `
      <h2>Levels</h2>
      ${message ? `<p class="status error">${esc(message)}</p>` : ''}
      <div class="ed-new">
        <label>Song <select data-pick="song">${songs.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('')}
          <option value="file">Add a song file…</option></select></label>
        <input type="file" data-pick="file" accept="audio/*,.mp3,.ogg,.flac,.wav,.m4a,.opus" hidden>
        <div class="ed-cards">
          <button data-act="new-generated" class="ed-card"><b>From the music</b><span>the obstacles the game would make, to edit</span></button>
          <button data-act="new-blank" class="ed-card"><b>Blank</b><span>place everything yourself</span></button>
        </div>
      </div>
      <ol class="ed-list">${levels.map(l => `<li>
        <button data-act="open-level" data-id="${l.id}" class="ed-open"><span class="name">${esc(l.name)}</span>
        <span class="dur">${esc(this.app.songLabel(l.song))} · ${l.parts.length} obstacles</span></button>
        <button data-act="delete-level" data-id="${l.id}" class="link" title="Delete">delete</button></li>`).join('') || '<li class="empty">No levels yet: make one above.</li>'}</ol>
      <nav class="list row">
        <label class="ed-file"><input type="file" data-pick="import" accept=".vibl,application/json" hidden><span>Import .vibl</span></label>
        ${this.level ? '<button data-act="close-levels">Back to the level</button>' : ''}
        <button data-act="exit">Exit editor</button>
      </nav>`;
    box.hidden = false;
    const fileIn = box.querySelector('[data-pick="file"]');
    box.querySelector('[data-pick="song"]').onchange = e => { if (e.target.value === 'file') fileIn.click(); };
    fileIn.onchange = async () => {
      if (!fileIn.files.length) return;
      this.app.busy(true);
      try { await this.app.addSongFile(fileIn.files[0]); } catch (e) { this.app.busy(false); this.showLevels(e.message || String(e)); return; }
      this.app.busy(false);
      this.showLevels();
      this.out('levels').querySelector('[data-pick="song"]').value = String(this.app.songChoices().length - 1);
    };
    const imp = box.querySelector('[data-pick="import"]');
    imp.onchange = async () => {
      try { const l = await importLevel(imp.files[0]); saveLevel(l); await this.load(l); }
      catch (e) { this.showLevels(e.message || String(e)); }
    };
  }
  async newLevel(generated) {
    const sel = this.out('levels').querySelector('[data-pick="song"]');
    const choice = this.app.songChoices()[+sel.value];
    if (!choice) { this.showLevels('Pick a song first.'); return; }
    this.app.busy(true);
    try {
      const buffer = await this.app.loadSong(choice.song);
      const name = choice.label.replace(/^Disc track/, 'Track');
      const level = generated ? this.app.generate(choice.song, buffer, name) : newLevel(choice.song, name);
      if (!generated) level.shots.push({ t: 0, camera: 2, loops: 2, side: 0 });
      saveLevel(level);
      await this.load(level, buffer);
    } catch (e) { console.error(e); this.showLevels(e.message || String(e)); }
    finally { this.app.busy(false); }
  }
  async load(level, buffer) {
    this.app.busy(true);
    try { this.buffer = buffer || await this.app.loadSong(level.song); }
    catch (e) { this.app.busy(false); this.showLevels(e.message || String(e)); return; }
    this.app.busy(false);
    this.level = cleanLevel(level);
    this.duration = this.buffer.duration;
    this.peaks = peaksOf(this.buffer);
    this.undo = []; this.redo = [];
    this.selection.clear();
    this.t = 0;
    this.out('levels').hidden = true;
    this.fit();
    this.fillTop();
    this.inspect();
    this.dirty = true;
  }
  fillTop() {
    this.root.querySelector('.ed-top [data-field="name"]').value = this.level.name;
    this.out('song').textContent = this.app.songLabel(this.level.song);
    this.out('duration').textContent = ' / ' + fmt(this.duration).replace(/\.\d+$/, '');
    this.root.querySelector('[data-field="snap"]').value = this.snap;
    this.syncZoom();
  }

  // ---------- buttons and fields ----------
  act(name, el) {
    const sel = kind => this.selectedOf(kind);
    switch (name) {
      case 'levels': this.showLevels(); break;
      case 'close-levels': this.out('levels').hidden = true; break;
      case 'new-generated': this.newLevel(true); break;
      case 'new-blank': this.newLevel(false); break;
      case 'open-level': { const l = savedLevels().find(x => x.id === el.dataset.id); if (l) this.load(l); break; }
      case 'delete-level': deleteLevel(el.dataset.id); this.showLevels(); break;
      case 'play': this.playing ? this.pause() : this.play(); break;
      case 'home': this.seek(0); break;
      case 'undo': this.doUndo(); break;
      case 'redo': this.doRedo(); break;
      case 'export': if (this.level) { exportLevel(this.level); this.status('Exported', true); } break;
      case 'test': if (this.level) { this.pause(); this.app.playtest(this.level, this.buffer, 0); } break;
      case 'test-here': if (this.level) { this.pause(); this.app.playtest(this.level, this.buffer, this.t); } break;
      case 'help': this.out('help').hidden = !this.out('help').hidden; break;
      case 'exit': this.close(); this.app.exit(); break;
      case 'fit': this.fit(); break;
      case 'delete': this.deleteSelection(); break;
      case 'deselect': this.selection.clear(); this.inspect(); break;
      case 'tap-tempo': this.tapTempo(); break;
      case 'bpm-from-obstacles': this.bpmFromObstacles(); break;
      case 'key-from-view': this.edit(() => { const k = sel('keys')[0]; if (k) Object.assign(k, this.currentView(k.t, true)); }); break;
      case 'key-at-vibri': this.edit(() => { for (const k of sel('keys')) k.target = [0, -250, 0]; }); break;
      case 'add-here': this.addAt(el.dataset.kind, this.t); break;
      case 'set-road': { const r = +el.dataset.value; this.edit(() => { for (const p of sel('parts')) p.road = r; }); break; }
      case 'set-camera': { const c = +el.dataset.value; this.edit(() => { for (const s of sel('shots')) s.camera = c; }); break; }
      case 'set-side': { const v = +el.dataset.value; this.edit(() => { for (const s of sel('shots')) s.side = v; }); break; }
      case 'set-ease': { const v = el.dataset.value; this.edit(() => { for (const k of sel('keys')) k.ease = v; }); break; }
      case 'set-mode': { const v = el.dataset.value; this.edit(() => { for (const k of sel('keys')) k.mode = v; }); break; }
      case 'set-ramp': { const v = el.dataset.value === '1'; this.edit(() => { for (const c of sel('speeds')) c.ramp = v; }); break; }
      case 'clear-speed': this.edit(() => { for (const p of sel('parts')) p.speed = 0; }); break;
      case 'to-key': { const k = this.level.keys[+el.dataset.value]; if (k) { this.selection = new Set([k]); this.seek(k.t); this.inspect(); } break; }
    }
  }
  // a field changed (`live`: still being dragged or typed: no step of undo, the inspector kept)
  field(el, live = false) {
    const f = el.dataset.field;
    if (!f) return;
    if (f === 'snap') { this.snap = +el.value; this.dirty = true; return; }
    if (f === 'zoom') { this.zoomTo(this.zoomScale(+el.value), LABEL + this.width() / 2); return; }
    if (!this.level) return;
    if (['name', 'bpm', 'offset', 'speed', 'baseRange'].includes(f)) {
      const key = f === 'baseRange' ? 'speed' : f;
      const v = f === 'name' ? el.value : +el.value;
      if (live && !this.liveField) { this.snapshot(); this.liveField = f; }
      if (!live && this.liveField === f) { this.liveField = null; this.changed(); return; }
      this.edit(() => {
        if (key === 'name') this.level.name = v || 'Level';
        else if (key === 'offset') this.level.offset = Number.isFinite(v) ? v : 0;
        else if (Number.isFinite(v) && v > 0) this.level[key] = key === 'speed' ? clamp(v, MIN_SPEED, MAX_SPEED) : v;
      }, true);
      if (f === 'baseRange') { const n = this.root.querySelector('.ed-side [data-field="speed"]'); if (n) n.value = v; }
      return;
    }
    // the inspector: the selected items' fields
    const kind = el.dataset.kind;
    const items = this.selectedOf(kind);
    const v = +el.value;
    if (live && !this.liveField) { this.snapshot(); this.liveField = f; }
    const wasLive = this.liveField === f && !live;
    if (wasLive) this.liveField = null;
    this.edit(() => {
      for (const it of items) {
        if (f === 't') it.t = Math.max(0, v || 0);
        else if (f === 'loops') it.loops = clamp(Math.round(v) || 2, 1, 9);
        else if (f === 'speedOwn') it.speed = el.value === '' ? 0 : clamp(v, MIN_SPEED, MAX_SPEED);
        else if (f === 'speedValue' || f === 'speedRange') it.speed = round3(clamp(v || DEFAULT_SPEED, MIN_SPEED, MAX_SPEED));
        else if (f === 'length') it.length = Math.max(0.1, v || 1);
        else if (f === 'roll' || f === 'fov') it[f] = v || 0;
        else if (/^(eye|target)[012]$/.test(f)) it[f.slice(0, -1)][+f.slice(-1)] = v || 0;
      }
    }, live || wasLive);
    if (f === 'speedRange') { const n = this.root.querySelector('[data-field="speedValue"]'); if (n) n.value = v; }
  }

  // ---------- changes, undo ----------
  // changes the level (a step of undo unless `quiet`), then keeps it
  edit(fn, quiet = false) {
    if (!this.level) return;
    if (!quiet) this.snapshot();
    fn();
    sortLevel(this.level);
    this.changed(quiet);
  }
  snapshot() { this.undo.push(JSON.stringify(this.level)); if (this.undo.length > 200) this.undo.shift(); this.redo = []; }
  changed(keepInspector = false) {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveLevel(this.level), 300);
    if (!keepInspector) this.inspect();
  }
  doUndo() { if (!this.undo.length) return; this.redo.push(JSON.stringify(this.level)); this.restore(this.undo.pop()); this.status('Undone'); }
  doRedo() { if (!this.redo.length) return; this.undo.push(JSON.stringify(this.level)); this.restore(this.redo.pop()); this.status('Redone'); }
  restore(json) { this.level = cleanLevel(JSON.parse(json)); this.selection.clear(); this.fillTop(); this.changed(); }

  selectedOf(kind) { return this.level && this.level[kind] ? this.level[kind].filter(it => this.selection.has(it)) : []; }
  kindOf(item) { return LANES.find(l => this.level[l.key].includes(item))?.key; }
  deleteSelection() {
    if (!this.selection.size) return;
    const n = this.selection.size;
    this.edit(() => { for (const l of LANES) this.level[l.key] = this.level[l.key].filter(it => !this.selection.has(it)); });
    this.selection.clear();
    this.inspect();
    this.status(`Deleted ${n}`);
  }

  beat() { return 60 / this.level.bpm; }
  snapTime(t) {
    if (!this.snap || !this.level) return round3(Math.max(0, t));
    const step = this.beat() / this.snap;
    return round3(Math.max(0, this.level.offset + Math.round((t - this.level.offset) / step) * step));
  }

  // a new item of a lane at `t` (`value`: a speed change's speed)
  addAt(kind, t, select = true, value) {
    let item;
    this.edit(() => {
      t = this.snapTime(t);
      if (kind === 'parts') item = { t, road: ROAD_OF_BITS[this.brushBits] ?? 0, speed: 0 };
      else if (kind === 'speeds') item = { t, speed: round3(clamp(value ?? speedAt(this.level, t), MIN_SPEED, MAX_SPEED)), ramp: false };
      else if (kind === 'shots') {
        const before = this.level.shots.filter(s => s.t <= t).pop();
        item = { t, camera: this.brushShot, loops: 2, side: before ? before.side ^ 1 : 0 };
      } else if (kind === 'breaks') item = { t };
      else if (kind === 'twists') item = { t, length: 4 };
      else item = { t, mode: 'free', ease: 'smooth', ...this.currentView(t) };
      this.level[kind].push(item);
    });
    if (select) { this.selection = new Set([item]); this.inspect(); }
    return item;
  }

  // the view at `t`: the free camera's, else the game's
  currentView(t = this.t, gameOnly = false) {
    const free = !gameOnly && freeCameraAt(this.level.keys, t);
    if (free) return { eye: free.eye.map(Math.round), target: free.target.map(Math.round), roll: Math.round(free.roll), fov: Math.round(free.fov) };
    const g = this.app.game();
    const last = g && g.camera && g.camera.movie && g.camera.movie.last;
    if (last) return { eye: last.eye.map(Math.round), target: last.target.map(Math.round), roll: last.roll, fov: last.fov };
    return { eye: [0, -900, -3200], target: [0, -250, 0], roll: 0, fov: 400 };
  }

  // ---------- the tempo ----------
  tapTempo() {
    const now = performance.now();
    this.taps = this.taps.filter(x => now - x < 2500);
    this.taps.push(now);
    if (this.taps.length >= 3) {
      const gaps = this.taps.slice(1).map((x, i) => x - this.taps[i]);
      const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10;
      if (this.taps.length === 3) this.snapshot();
      this.edit(() => { this.level.bpm = bpm; }, true);
      this.status(`Tempo ${bpm} BPM: keep tapping`);
    } else this.status('Tap T on the beat…');
  }
  // the tempo the obstacles keep to: their most common gap, as a beat
  bpmFromObstacles() {
    const p = this.level.parts;
    if (p.length < 4) { this.status('Not enough obstacles to tell'); return; }
    const gaps = p.slice(1).map((x, i) => x.t - p[i].t).filter(g => g > 0.15 && g < 3);
    const counts = new Map();
    for (const g of gaps) { const k = Math.round(g * 50) / 50; counts.set(k, (counts.get(k) || 0) + 1); }
    let best = 0, gap = 0.5;
    for (const [k, c] of counts) if (c > best) { best = c; gap = k; }
    let bpm = 60 / gap;
    while (bpm < 80) bpm *= 2;
    while (bpm > 200) bpm /= 2;
    bpm = Math.round(bpm * 10) / 10;
    const beat = 60 / bpm;
    const offset = round3(((p[0].t % beat) + beat) % beat);
    this.edit(() => { this.level.bpm = bpm; this.level.offset = offset; });
    this.status(`Tempo ${bpm} BPM from the obstacles`, true);
  }

  // ---------- the inspector ----------
  inspect() {
    const box = this.out('inspector');
    if (!this.level) { box.innerHTML = ''; return; }
    const l = this.level;
    const sel = [...this.selection];
    if (!sel.length) { box.innerHTML = this.levelPanel(); return; }
    const kind = this.kindOf(sel[0]);
    if (!kind) { this.selection.clear(); box.innerHTML = this.levelPanel(); return; }
    const lane = LANES.find(x => x.key === kind);
    const items = this.selectedOf(kind);
    const it = items[0];
    const n = items.length, others = sel.length - n;
    const num = (field, value, attrs = '') => `<input type="number" data-kind="${kind}" data-field="${field}" value="${value}" ${attrs}>`;
    const seg = (act, options, value) => `<div class="ed-seg">${options.map(([v, label, title]) => `<button data-act="${act}" data-value="${v}" class="${String(v) === String(value) ? 'on' : ''}" ${title ? `title="${title}"` : ''}>${label}</button>`).join('')}</div>`;
    let html = `<div class="ed-head" style="--lane:${lane.color}"><b>${lane.name}</b>${n > 1 ? `<span>${n} selected</span>` : ''}
      ${others ? `<span class="ed-note">+ ${others} other</span>` : ''}
      <button data-act="deselect" class="ed-x" title="Deselect (Esc)">✕</button></div>
      <div class="ed-fields"><label>Time ${num('t', it.t, 'step="0.001" min="0"')}<small>${fmt(it.t)}</small></label>`;
    if (kind === 'parts') {
      html += `<div class="ed-field"><span>Road</span><div class="ed-roads">${ROADS.map((r, i) => {
        const g = [0, 1, 2, 3].filter(k => BITS_OF_ROAD[i] & (1 << k)).map(glyphSvg).join('');
        return `<button data-act="set-road" data-value="${i}" class="${i === it.road ? 'on' : ''}" title="${r.name}">${g}</button>`;
      }).join('')}</div></div>
        <label>Own speed ${num('speedOwn', it.speed || '', `step="0.05" min="${MIN_SPEED}" max="${MAX_SPEED}" placeholder="${speedAt(l, it.t).toFixed(2)}"`)}
        ${it.speed ? '<button data-act="clear-speed" class="link">use the road\'s</button>' : '<small>empty: the road\'s</small>'}</label>`;
    } else if (kind === 'speeds') {
      html += `<label class="ranged">Speed <input type="range" data-kind="speeds" data-field="speedRange" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.05" value="${it.speed}">
        ${num('speedValue', it.speed, `step="0.05" min="${MIN_SPEED}" max="${MAX_SPEED}"`)}</label>
        <div class="ed-field"><span>Change</span>${seg('set-ramp', [[0, 'Jump', 'Changes at once'], [1, 'Ramp', 'Gets there gradually from the change before']], it.ramp ? 1 : 0)}</div>
        <p class="ed-note">Obstacles from here on come at this speed${it.ramp ? ', reached gradually from the change before' : ''}. Units a second; the game's own pace is about 2. An obstacle's own speed wins.</p>`;
    } else if (kind === 'shots') {
      html += `<div class="ed-field"><span>Camera</span>${seg('set-camera', SHOTS.map(s => [s.id, SHOT_SHORT[s.id], s.name]), it.camera)}</div>
        <label>Loops ${num('loops', it.loops, 'min="1" max="9"')}<small>times the shot plays</small></label>
        <div class="ed-field"><span>Side</span>${seg('set-side', [[0, 'Left'], [1, 'Right']], it.side)}</div>`;
    } else if (kind === 'breaks') {
      html += `<p class="ed-note">The camera moves on to its next shot here, through a transition.</p>`;
    } else if (kind === 'twists') {
      html += `<label>Length ${num('length', it.length, 'step="0.1" min="0.1"')}<small>seconds the road leans</small></label>`;
    } else if (kind === 'keys') {
      const i = l.keys.indexOf(it);
      html += `<div class="ed-field"><span>Then</span>${seg('set-mode', [['free', 'This view'], ['game', 'Game camera', "Hand back to the game's shots"]], it.mode)}</div>
        <div class="ed-field"><span>To next</span>${seg('set-ease', [['smooth', 'Smooth'], ['linear', 'Linear'], ['cut', 'Cut']], it.ease)}</div>
        <div class="ed-xyz"><span>Eye</span>${[0, 1, 2].map(j => num('eye' + j, it.eye[j], `step="10" title="${'xyz'[j]}"`)).join('')}</div>
        <div class="ed-xyz"><span>Look at</span>${[0, 1, 2].map(j => num('target' + j, it.target[j], `step="10" title="${'xyz'[j]}"`)).join('')}</div>
        <label>Roll ${num('roll', it.roll, 'step="16"')}</label><label>Zoom ${num('fov', it.fov, 'step="10" min="40" max="2000"')}</label>
        <div class="ed-buttons"><button data-act="key-from-view" title="The game camera's view at this time">Game's view here</button><button data-act="key-at-vibri">Look at Vibri</button>
        ${i > 0 ? `<button data-act="to-key" data-value="${i - 1}">‹ Prev</button>` : ''}${i < l.keys.length - 1 ? `<button data-act="to-key" data-value="${i + 1}">Next ›</button>` : ''}</div>
        ${it.mode === 'free' && n === 1 ? '<p class="ed-note">Fly it in the preview: drag to orbit, Shift+drag to pan, wheel to move in, Alt+wheel to zoom.</p>' : ''}`;
    }
    html += `</div><div class="ed-buttons ed-end"><button data-act="delete" class="ed-danger">Delete${sel.length > 1 ? ` ${sel.length}` : ''}</button></div>`;
    box.innerHTML = html;
  }
  levelPanel() {
    const l = this.level;
    const per = l.parts.length / Math.max(1, this.duration / 60);
    const speeds = [l.speed, ...l.speeds.map(c => c.speed)];
    const doubles = l.parts.filter(p => p.road >= 4).length;
    return `<div class="ed-head" style="--lane:#ddd"><b>Level</b></div>
      <div class="ed-fields">
        <label>Tempo <input type="number" data-field="bpm" min="30" max="400" step="0.1" value="${l.bpm}"><small>BPM</small></label>
        <div class="ed-buttons"><button data-act="tap-tempo" title="Tap on the beat (T)">Tap tempo</button><button data-act="bpm-from-obstacles">From the obstacles</button></div>
        <label>Offset <input type="number" data-field="offset" step="0.001" value="${l.offset}"><small>s to the first beat</small></label>
        <label class="ranged">Speed <input type="range" data-field="baseRange" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.05" value="${l.speed}">
          <input type="number" data-field="speed" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.05" value="${l.speed}"><small>at the start</small></label>
      </div>
      <div class="ed-stats">
        <div><b>${l.parts.length}</b><span>obstacles</span></div><div><b>${doubles}</b><span>doubles</span></div>
        <div><b>${per.toFixed(0)}</b><span>a minute</span></div><div><b>${Math.min(...speeds).toFixed(1)}–${Math.max(...speeds).toFixed(1)}</b><span>speed</span></div>
        <div><b>${l.shots.length}</b><span>shots</span></div><div><b>${l.keys.length}</b><span>camera keys</span></div>
      </div>
      <div class="ed-add"><span>Add at the playhead</span>${LANES.map(x => `<button data-act="add-here" data-kind="${x.key}" style="--lane:${x.color}">${x.name}</button>`).join('')}</div>`;
  }

  // ---------- playing ----------
  play() {
    if (!this.level || this.playing) return;
    if (this.t >= this.duration - 0.05) this.t = 0;
    this.app.music.offsetMs = 0;
    this.app.music.play(this.buffer, 0.05, this.t);
    this.playing = true;
    this.root.querySelector('.ed-play').textContent = '❚❚';
    this.rebuild(this.t);
  }
  pause() {
    if (!this.playing) return;
    this.t = Math.max(0, this.app.music.position() / RATE);
    this.app.music.stop();
    this.playing = false;
    this.root.querySelector('.ed-play').textContent = '▶';
    this.dirty = true;
  }
  seek(t) {
    this.t = clamp(t, 0, this.duration || 0);
    if (this.playing) { this.app.music.play(this.buffer, 0.02, this.t); this.rebuild(this.t); }
    this.dirty = true;
  }

  // the scene at `t`: the level's events up to then, the obstacles done, the camera's shot played on to `t`
  rebuild(t) {
    const g = this.app.game();
    if (!g || !this.level) return;
    const sfx = g.sfx, was = sfx.enabled;
    sfx.enabled = false;
    const endTime = Math.floor(this.duration * RATE);
    g.start({ course: 'level', analyser: new LevelSource(this.level), seconds: Math.floor(this.duration), endTime, auto: true, level: this.level });
    g.update(Math.floor(t * RATE), 0, 0);
    const cams = [...this.level.shots, ...this.level.breaks].filter(c => c.t <= t).sort((a, b) => a.t - b.t);
    const lastCam = cams[cams.length - 1];
    if (lastCam) {
      let el = t - lastCam.t;
      const cam = g.camera;
      if (cam.inTransition) {
        const m = cam.movie, frames = el * m.rate;
        if (frames < m.numFrames) m.seek(m.speed < 0 ? m.numFrames - 0.5 - frames : frames + 0.5);
        else { el -= m.numFrames / m.rate; cam.startBase(); }
      }
      if (!cam.inTransition) {
        const m = cam.movie, frames = el * m.rate * Math.abs(m.speed);
        cam.loopsDone = Math.min(cam.numLoops - 1, Math.floor(frames / m.numFrames));
        m.seek((frames % m.numFrames) + 0.5);
      }
    }
    sfx.enabled = was;
  }

  // a frame of the editor: the preview, the timeline
  frame(dt, r) {
    if (!this.level) { r.clear(); this.overlay(''); return; }
    const g = this.app.game();
    if (this.playing) {
      const pos = this.app.music.position();
      this.t = pos / RATE;
      if (this.t >= this.duration) { this.pause(); this.t = this.duration; }
      else {
        if (this.dirty) { this.rebuild(this.t); this.dirty = false; }
        g.update(Math.max(0, pos), 0, dt);
      }
    } else if (this.dirty) { this.rebuild(this.t); this.dirty = false; }
    r.clear();
    if (g.frame) { g.frame.dt = this.playing ? dt : 0; if (!this.playing) g.frame.time = this.t; g.drawScene(r); }
    this.out('time').textContent = fmt(this.t);
    // what the camera and the road are doing, over the preview
    const free = freeCameraAt(this.level.keys, this.t);
    const shot = this.level.shots.filter(s => s.t <= this.t).pop();
    const speed = speedAt(this.level, this.t);
    this.overlay(`<span><i style="--c:${free ? '#50c8dc' : '#9a9aff'}"></i>${free ? 'Free camera' : shot ? SHOTS.find(s => s.id === shot.camera)?.name : 'Behind 2'}</span>
      <span><i style="--c:#7ee0a1"></i>Speed ${speed.toFixed(2)}</span>${this.flyKey() ? '<span class="fly">Flying the camera key: drag, Shift+drag, wheel</span>' : ''}`);
    // keep the playhead in sight while playing
    const w = this.width();
    if (this.playing && (this.t < this.view.start || this.t > this.view.start + w / this.view.scale * 0.85)) this.view.start = this.t - w / this.view.scale * 0.15;
    this.drawTimeline();
  }
  overlay(html) { if (this.lastOverlay !== html) { this.out('overlay').innerHTML = html; this.lastOverlay = html; } }

  // ---------- the timeline's geometry ----------
  sizeTimeline() {
    const dpr = window.devicePixelRatio || 1;
    // the lanes grow to fill the room there is
    const main = this.root.querySelector('.ed-main'), tools = this.root.querySelector('.ed-tools');
    const room = main.clientHeight - tools.offsetHeight - OVERVIEW - RULER - WAVE - 4;
    const base = LANES.reduce((a, l) => a + (l.h0 || (l.h0 = l.h)), 0);
    const k = clamp(room / base, 1, 2.2);
    for (const l of LANES) l.h = Math.round(l.h0 * k);
    const h = OVERVIEW + RULER + WAVE + LANES.reduce((a, l) => a + l.h, 0) + 2;
    this.canvas.style.height = h + 'px';
    const w = this.canvas.getBoundingClientRect().width || 800;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
  }
  width() { return this.canvas.width / this.dpr - LABEL; }
  xOf(t) { return LABEL + (t - this.view.start) * this.view.scale; }
  tOf(x) { return this.view.start + (x - LABEL) / this.view.scale; }
  laneTop(key) { let y = OVERVIEW + RULER + WAVE; for (const l of LANES) { if (l.key === key) return y; y += l.h; } return y; }
  laneAt(y) { let top = OVERVIEW + RULER + WAVE; for (const l of LANES) { if (y >= top && y < top + l.h) return l.key; top += l.h; } return null; }
  // the speed lane: a speed's height, and back
  speedY(v) { const top = this.laneTop('speeds'), h = LANES[1].h; return top + h - 6 - (v - MIN_SPEED) / (MAX_SPEED - MIN_SPEED) * (h - 12); }
  speedOfY(y) { const top = this.laneTop('speeds'), h = LANES[1].h; return clamp(MIN_SPEED + (top + h - 6 - y) / (h - 12) * (MAX_SPEED - MIN_SPEED), MIN_SPEED, MAX_SPEED); }

  fit() {
    if (!this.duration) return;
    this.view.scale = Math.max(4, this.width() / (this.duration + 2));
    this.view.start = -1;
    this.syncZoom();
  }
  // the zoom slider: 0 the whole song, 100 the closest
  zoomScale(v) { const lo = Math.max(4, this.width() / ((this.duration || 60) + 2)), hi = 1200; return lo * Math.pow(hi / lo, v / 100); }
  syncZoom() {
    const lo = Math.max(4, this.width() / ((this.duration || 60) + 2)), hi = 1200;
    const el = this.root.querySelector('[data-field="zoom"]');
    if (el) el.value = Math.round(Math.log(this.view.scale / lo) / Math.log(hi / lo) * 100);
  }
  zoomTo(scale, x) {
    const t = this.tOf(x);
    this.view.scale = clamp(scale, 4, 1200);
    this.view.start = clamp(t - (x - LABEL) / this.view.scale, -2, this.duration);
    this.syncZoom();
  }

  // the item of a lane at x (y for the speed lane), and whether it is a twist's end
  itemAt(kind, x, y) {
    let best = null, bestD = 1e9, handle = false;
    for (const it of this.level[kind]) {
      const x0 = this.xOf(it.t);
      let d;
      if (kind === 'twists') {
        const x1 = this.xOf(it.t + it.length);
        if (Math.abs(x - x1) < 6) { best = it; bestD = 0; handle = true; continue; }
        d = x >= x0 && x <= x1 ? 0.5 : Math.min(Math.abs(x - x0), Math.abs(x - x1));
      } else if (kind === 'shots') d = x >= x0 && x <= x0 + this.shotWidth(it) ? 0 : Math.abs(x - x0);
      else if (kind === 'speeds') d = Math.hypot(x - x0, (y - this.speedY(it.speed)) * 0.6);
      else d = Math.abs(x - x0);
      if (d < bestD) { best = it; bestD = d; handle = false; }
    }
    return bestD <= 8 ? { item: best, handle } : null;
  }
  shotWidth(s) { this.ctx.font = '11px system-ui, sans-serif'; return Math.max(18, this.ctx.measureText(this.shotLabel(s)).width + 12); }
  shotLabel(s) { return `${SHOT_SHORT[s.camera]} ×${s.loops} ${s.side ? 'R' : 'L'}`; }

  // ---------- the timeline's mouse ----------
  bindTimeline() {
    const c = this.canvas;
    const pt = e => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    c.addEventListener('pointerdown', e => {
      if (!this.level) return;
      c.setPointerCapture(e.pointerId);
      const { x, y } = pt(e);
      if (y < OVERVIEW) { this.drag = { type: 'overview' }; this.overviewTo(x); return; }
      if (x < LABEL) return;
      const kind = this.laneAt(y);
      if (!kind) { this.drag = { type: 'seek' }; this.seek(this.tOf(x)); return; }
      const hit = this.itemAt(kind, x, y);
      if (!hit) {
        if (!e.shiftKey) this.selection.clear();
        this.drag = { type: 'box', kind, x0: x, x1: x };
        this.inspect();
        return;
      }
      if (e.shiftKey) { if (this.selection.has(hit.item)) this.selection.delete(hit.item); else this.selection.add(hit.item); }
      else if (!this.selection.has(hit.item)) this.selection = new Set([hit.item]);
      if (kind === 'keys') this.seek(hit.item.t);
      this.inspect();
      this.drag = {
        type: hit.handle ? 'length' : 'move', kind, anchor: hit.item, t0: this.tOf(x), y0: y,
        starts: [...this.selection].map(it => [it, it.t, it.length, it.speed]), moved: false,
      };
    });
    c.addEventListener('pointermove', e => {
      const { x, y } = pt(e);
      const d = this.drag;
      if (!d) { this.hoverAt(x, y); return; }
      if (d.type === 'overview') { this.overviewTo(x); return; }
      if (d.type === 'seek') { this.seek(this.tOf(x)); return; }
      if (d.type === 'box') { d.x1 = x; return; }
      const dt = this.tOf(x) - d.t0, dy = y - d.y0;
      if (!d.moved) { if (Math.abs(dt * this.view.scale) < 3 && Math.abs(dy) < 3) return; this.snapshot(); d.moved = true; }
      if (d.type === 'move') {
        const anchor = d.starts.find(s => s[0] === d.anchor);
        const shift = this.snapTime(anchor[1] + dt) - anchor[1];
        for (const [it, t] of d.starts) it.t = round3(Math.max(0, t + shift));
        // speed changes move up and down too
        if (d.kind === 'speeds') {
          const dv = this.speedOfY(this.speedY(anchor[3]) + dy) - anchor[3];
          for (const [it, , , v] of d.starts) if (v !== undefined && this.level.speeds.includes(it)) it.speed = round3(clamp(v + dv, MIN_SPEED, MAX_SPEED));
        }
      } else {
        for (const [it, , len] of d.starts) if (len !== undefined) it.length = round3(Math.max(0.1, this.snapTime(it.t + len + dt) - it.t));
      }
      this.dirty = true;
      this.hover = null;
    });
    c.addEventListener('pointerup', () => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.type === 'box') {
        const a = Math.min(d.x0, d.x1), b = Math.max(d.x0, d.x1);
        if (b - a < 3) { this.seek(this.tOf(a)); return; }
        for (const it of this.level[d.kind]) { const x = this.xOf(it.t); if (x >= a && x <= b) this.selection.add(it); }
        this.inspect();
      } else if (d.moved) { sortLevel(this.level); this.changed(); }
    });
    c.addEventListener('pointerleave', () => { this.hover = null; });
    c.addEventListener('dblclick', e => {
      if (!this.level) return;
      const { x, y } = pt(e);
      const kind = this.laneAt(y);
      if (kind && x >= LABEL && !this.itemAt(kind, x, y)) this.addAt(kind, this.tOf(x), true, kind === 'speeds' ? this.speedOfY(y) : undefined);
    });
    c.addEventListener('wheel', e => {
      if (!this.level) return;
      e.preventDefault();
      const { x } = pt(e);
      if (e.ctrlKey || e.metaKey) this.zoomTo(this.view.scale * Math.exp(-e.deltaY * 0.0015), Math.max(LABEL, x));
      else this.view.start = clamp(this.view.start + (e.deltaX || e.deltaY) / this.view.scale, -2, this.duration);
    }, { passive: false });
  }
  overviewTo(x) {
    const W = this.canvas.width / this.dpr;
    const span = this.width() / this.view.scale;
    this.view.start = clamp((x - LABEL) / (W - LABEL) * this.duration - span / 2, -2, this.duration);
  }
  hoverAt(x, y) {
    const kind = y >= OVERVIEW && x >= LABEL ? this.laneAt(y) : null;
    const hit = kind && this.itemAt(kind, x, y);
    this.hover = hit ? { kind, item: hit.item, x, y } : kind ? { kind, x, y } : null;
    this.canvas.style.cursor = !kind ? (y < OVERVIEW ? 'pointer' : 'text')
      : hit ? (hit.handle ? 'ew-resize' : kind === 'speeds' ? 'move' : 'grab') : 'crosshair';
  }
  tooltip(h) {
    const it = h.item;
    if (!it) return '';
    if (h.kind === 'parts') return `${ROADS[it.road].name} · ${fmt(it.t)}${it.speed ? ` · own speed ${it.speed}` : ''}`;
    if (h.kind === 'speeds') return `Speed ${it.speed} · ${fmt(it.t)} · ${it.ramp ? 'ramp' : 'jump'}`;
    if (h.kind === 'shots') return `${SHOTS.find(s => s.id === it.camera)?.name} · ${it.loops} loops · ${it.side ? 'right' : 'left'} · ${fmt(it.t)}`;
    if (h.kind === 'twists') return `Twist · ${fmt(it.t)} for ${it.length}s`;
    if (h.kind === 'keys') return `Camera key · ${fmt(it.t)} · ${it.mode === 'free' ? it.ease : "back to the game's camera"}`;
    return `Break · ${fmt(it.t)}`;
  }

  // ---------- the timeline drawn ----------
  drawTimeline() {
    const ctx = this.ctx, dpr = this.dpr, l = this.level;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070707'; ctx.fillRect(0, 0, W, H);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const t0 = this.view.start, t1 = this.tOf(W);
    const sel = it => this.selection.has(it);
    const top = OVERVIEW + RULER + WAVE;

    // the overview: the whole song, the part in view
    if (this.peaks) {
      const p = this.peaks, ow = W - LABEL;
      ctx.fillStyle = '#101418'; ctx.fillRect(LABEL, 0, ow, OVERVIEW);
      ctx.fillStyle = '#2b3846';
      for (let x = 0; x < ow; x++) {
        const a = Math.floor(x / ow * p.length), b = Math.max(a + 1, Math.floor((x + 1) / ow * p.length));
        let m = 0; for (let i = a; i < b; i++) if (p[i] > m) m = p[i];
        ctx.fillRect(LABEL + x, OVERVIEW / 2 - m * 8, 1, Math.max(1, m * 16));
      }
      ctx.fillStyle = 'rgba(255,138,92,.7)';
      for (const q of l.parts) ctx.fillRect(LABEL + q.t / this.duration * ow, OVERVIEW - 3, 1, 3);
      const vx = LABEL + Math.max(0, t0) / this.duration * ow, vw = Math.max(3, (Math.min(this.duration, t1) - Math.max(0, t0)) / this.duration * ow);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(vx, 0, vw, OVERVIEW);
      ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(vx) + 0.5, 0.5, Math.round(vw), OVERVIEW - 1);
      ctx.fillStyle = '#ff4040'; ctx.fillRect(LABEL + this.t / this.duration * ow, 0, 1, OVERVIEW);
    }

    // beats and bars
    const beat = this.beat();
    const step = this.snap ? beat / this.snap : beat;
    const drawStep = step * this.view.scale > 5 ? step : beat * this.view.scale > 5 ? beat : beat * 4;
    if (drawStep * this.view.scale > 2) {
      for (let k = Math.ceil((Math.max(0, t0) - l.offset) / drawStep); ; k++) {
        const t = l.offset + k * drawStep;
        if (t > t1) break;
        const nb = (t - l.offset) / beat;
        const onBeat = Math.abs(nb - Math.round(nb)) < 1e-6;
        const bar = onBeat && Math.round(nb) % 4 === 0;
        ctx.fillStyle = bar ? '#2a2a2a' : onBeat ? '#1a1a1a' : '#111';
        ctx.fillRect(Math.round(this.xOf(t)), OVERVIEW + RULER, 1, H - OVERVIEW - RULER);
      }
    }
    // the ruler: seconds, and the bars' numbers
    ctx.fillStyle = '#0c0c0c'; ctx.fillRect(LABEL, OVERVIEW, W, RULER);
    const every = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].find(s => s * this.view.scale >= 64) || 120;
    ctx.fillStyle = '#8a8a8a';
    for (let s = Math.max(0, Math.ceil(t0 / every) * every); s <= t1; s += every) {
      const x = this.xOf(s);
      ctx.fillRect(Math.round(x), OVERVIEW + RULER - 7, 1, 7);
      ctx.fillText(every < 1 ? fmt(s) : fmt(s).replace(/\.00$/, ''), x + 3, OVERVIEW + 8);
    }
    if (beat * 4 * this.view.scale > 26) {
      ctx.fillStyle = '#4e4e4e';
      for (let b = Math.max(0, Math.ceil((t0 - l.offset) / (beat * 4))); ; b++) {
        const t = l.offset + b * beat * 4;
        if (t > t1) break;
        ctx.fillText(String(b + 1), this.xOf(t) + 3, OVERVIEW + RULER - 5);
      }
    }
    // the waveform
    if (this.peaks) {
      const p = this.peaks, mid = OVERVIEW + RULER + WAVE / 2;
      ctx.fillStyle = '#34495e';
      for (let x = LABEL; x < W; x++) {
        const a = Math.floor(this.tOf(x) * 100), b = Math.max(a + 1, Math.floor(this.tOf(x + 1) * 100));
        let m = 0;
        for (let i = Math.max(0, a); i < Math.min(p.length, b); i++) if (p[i] > m) m = p[i];
        if (m) ctx.fillRect(x, mid - m * (WAVE - 6) / 2, 1, Math.max(1, m * (WAVE - 6)));
      }
    }
    // the lanes
    let y = top;
    for (const lane of LANES) {
      ctx.fillStyle = 'rgba(255,255,255,0.018)'; ctx.fillRect(LABEL, y, W, lane.h);
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(LABEL, y, W, 1);
      if (this.hover && this.hover.kind === lane.key) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(LABEL, y, W, lane.h); }
      y += lane.h;
    }

    // obstacles: the roads' drawings, a double as two
    y = this.laneTop('parts');
    const ph = LANES[0].h;
    const s = this.view.scale > 60 ? 7 : 5;
    for (const p of l.parts) {
      const x = this.xOf(p.t);
      if (x < LABEL - 20 || x > W + 20) continue;
      const bits = BITS_OF_ROAD[p.road];
      const roads = [0, 1, 2, 3].filter(r => bits & (1 << r));
      if (sel(p)) { ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(x - s - 3, y + 2, (s + 3) * 2, ph - 4); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x - s - 2.5, y + 2.5, (s + 3) * 2 - 1, ph - 5); }
      roads.forEach((r, k) => roadGlyph(ctx, r, x, y + (roads.length > 1 ? (k ? ph * 0.7 : ph * 0.3) : ph / 2), s, ROAD_COLORS[r]));
      if (p.speed) { ctx.fillStyle = '#7ee0a1'; ctx.beginPath(); ctx.arc(x, y + 4, 2, 0, Math.PI * 2); ctx.fill(); }
    }

    // speed: the line of the road's speed, its changes as dots (a ramp as a diamond)
    y = this.laneTop('speeds');
    const sh = LANES[1].h;
    ctx.fillStyle = '#161616';
    for (const v of [2, 4, 6]) ctx.fillRect(LABEL, Math.round(this.speedY(v)), W, 1);
    ctx.fillStyle = '#4a4a4a';
    for (const v of [2, 4, 6]) ctx.fillText(String(v), LABEL + 3, this.speedY(v) - 5);
    const from = Math.max(0, t0), to = Math.min(this.duration, t1);
    if (to > from) {
      const pts = [from, ...l.speeds.flatMap(c => [c.t - 1e-4, c.t]).filter(t => t > from && t < to), to];
      ctx.beginPath();
      pts.forEach((t, i) => { const px = this.xOf(t), py = this.speedY(speedAt(l, t)); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.strokeStyle = '#7ee0a1'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.lineTo(this.xOf(to), y + sh); ctx.lineTo(this.xOf(from), y + sh); ctx.closePath();
      ctx.fillStyle = 'rgba(126,224,161,0.07)'; ctx.fill();
    }
    for (const c of l.speeds) {
      const x = this.xOf(c.t), cy = this.speedY(c.speed);
      if (x < LABEL - 10 || x > W + 10) continue;
      ctx.fillStyle = sel(c) ? '#fff' : '#7ee0a1';
      ctx.beginPath();
      if (c.ramp) { ctx.moveTo(x, cy - 6); ctx.lineTo(x + 6, cy); ctx.lineTo(x, cy + 6); ctx.lineTo(x - 6, cy); ctx.closePath(); }
      else ctx.arc(x, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      if (sel(c)) { ctx.fillStyle = '#ddd'; ctx.fillText(c.speed.toFixed(2), x + 8, cy - 8 < y + 6 ? cy + 8 : cy - 8); }
    }

    // shots
    y = this.laneTop('shots');
    for (const st of l.shots) {
      const x = this.xOf(st.t), w = this.shotWidth(st);
      if (x > W || x + w < LABEL) continue;
      ctx.fillStyle = sel(st) ? '#d9d9ff' : '#2d2d4a'; roundRect(ctx, x, y + 4, w, LANES[2].h - 8, 4); ctx.fill();
      ctx.fillStyle = sel(st) ? '#000' : '#cfcfff'; ctx.fillText(this.shotLabel(st), x + 6, y + LANES[2].h / 2);
    }
    // breaks
    y = this.laneTop('breaks');
    for (const b of l.breaks) {
      const x = this.xOf(b.t);
      ctx.fillStyle = sel(b) ? '#fff' : '#e0a64a';
      ctx.beginPath(); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x, y + LANES[3].h - 4); ctx.closePath(); ctx.fill();
    }
    // twists
    y = this.laneTop('twists');
    for (const w of l.twists) {
      const x = this.xOf(w.t), x1 = this.xOf(w.t + w.length);
      ctx.fillStyle = sel(w) ? '#e6d2ff' : '#5a3d7a'; roundRect(ctx, x, y + 5, Math.max(3, x1 - x), LANES[4].h - 10, 3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(x1 - 2, y + 3, 3, LANES[4].h - 6);
    }
    // free camera keys, and the stretches the free camera shows
    y = this.laneTop('keys');
    const kh = LANES[5].h;
    l.keys.forEach((k, i) => {
      const x = this.xOf(k.t), next = l.keys[i + 1];
      if (k.mode === 'free') {
        const x1 = next ? this.xOf(next.t) : W;
        ctx.fillStyle = k.ease === 'cut' || !next || next.mode !== 'free' ? 'rgba(80,200,220,0.12)' : 'rgba(80,200,220,0.26)';
        ctx.fillRect(x, y + kh / 2 - 3, Math.max(0, x1 - x), 6);
      }
      ctx.save(); ctx.translate(x, y + kh / 2); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = sel(k) ? '#fff' : k.mode === 'free' ? '#50c8dc' : '#777'; ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    });
    // a box being drawn
    if (this.drag && this.drag.type === 'box') {
      const ly = this.laneTop(this.drag.kind), lh = LANES.find(x => x.key === this.drag.kind).h;
      const bx = Math.min(this.drag.x0, this.drag.x1), bw = Math.abs(this.drag.x1 - this.drag.x0);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(bx, ly + 1, bw, lh - 2);
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, ly + 1.5, bw, lh - 3);
    }
    // the labels
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, LABEL, H);
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(LABEL - 1, 0, 1, H);
    ctx.fillStyle = '#5e5e5e';
    ctx.fillText('song', 10, OVERVIEW / 2);
    ctx.fillText('time · bars', 10, OVERVIEW + RULER / 2);
    ctx.fillText('music', 10, OVERVIEW + RULER + WAVE / 2);
    y = top;
    for (const lane of LANES) {
      ctx.fillStyle = lane.color; ctx.fillRect(0, y + 4, 3, lane.h - 8);
      ctx.fillStyle = '#c4c4c4'; ctx.fillText(lane.name, 10, y + lane.h / 2);
      ctx.fillStyle = '#4a4a4a'; ctx.textAlign = 'right'; ctx.fillText(String(l[lane.key].length), LABEL - 8, y + lane.h / 2); ctx.textAlign = 'left';
      y += lane.h;
    }
    // the playhead
    const px = this.xOf(this.t);
    if (px >= LABEL && px <= W) {
      ctx.fillStyle = '#ff4040'; ctx.fillRect(Math.round(px) - 1, OVERVIEW, 2, H - OVERVIEW);
      ctx.beginPath(); ctx.moveTo(px - 6, OVERVIEW); ctx.lineTo(px + 6, OVERVIEW); ctx.lineTo(px, OVERVIEW + 7); ctx.closePath(); ctx.fill();
    }
    // the tooltip
    if (this.hover && this.hover.item && !this.drag) {
      const text = this.tooltip(this.hover);
      const tw = ctx.measureText(text).width + 14;
      const tx = clamp(this.hover.x + 12, LABEL, W - tw - 4), ty = clamp(this.hover.y - 26, OVERVIEW + 2, H - 22);
      ctx.fillStyle = 'rgba(22,22,22,0.96)'; roundRect(ctx, tx, ty, tw, 20, 4); ctx.fill();
      ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#eee'; ctx.fillText(text, tx + 7, ty + 10);
    }
  }

  // ---------- the keyboard ----------
  key(e) {
    if (!this.active || !this.level || !this.out('levels').hidden) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (e.code === 'Escape' || (e.code === 'Enter' && tag === 'INPUT')) e.target.blur();
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    let used = true;
    if (e.code === 'Space') { this.playing ? this.pause() : this.play(); }
    else if (KEY_ROADS[e.code] && !ctrl) { if (!e.repeat) this.tap(KEY_ROADS[e.code]); }
    else if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSelection();
    else if (ctrl && e.code === 'KeyZ') e.shiftKey ? this.doRedo() : this.doUndo();
    else if (ctrl && e.code === 'KeyY') this.doRedo();
    else if (ctrl && e.code === 'KeyA') { for (const lane of LANES) for (const it of this.level[lane.key]) this.selection.add(it); this.inspect(); }
    else if (ctrl && e.code === 'KeyC') this.copy();
    else if (ctrl && e.code === 'KeyV') this.paste();
    else if (e.code === 'KeyK' && !ctrl) this.addAt('keys', this.t);
    else if (e.code === 'KeyT' && !ctrl) this.tapTempo();
    else if (e.code === 'BracketLeft' || e.code === 'BracketRight') this.nudge(e.code === 'BracketLeft' ? -1 : 1);
    else if (e.code === 'Home') this.seek(0);
    else if (e.code === 'End') this.seek(this.duration);
    else if (e.code === 'Escape') { if (!this.out('help').hidden) this.out('help').hidden = true; else { this.selection.clear(); this.inspect(); } }
    else if (e.key === '?') this.act('help');
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  // an obstacle where the song is; a second road tapped at once makes it a double
  tap(bit) {
    const t = this.playing ? Math.max(0, this.app.music.position() / RATE) : this.t;
    const now = performance.now();
    const last = this.lastTap;
    if (last && now - last.at < 90 && this.level.parts.includes(last.part)) {
      const bits = BITS_OF_ROAD[last.part.road] | bit;
      if (ROAD_OF_BITS[bits] !== undefined && BITS_OF_ROAD[last.part.road] !== bit) {
        this.edit(() => { last.part.road = ROAD_OF_BITS[bits]; }, true);
        this.lastTap = null;
        return;
      }
    }
    const brush = this.brushBits;
    this.brushBits = bit;
    const part = this.addAt('parts', t, !this.playing);
    this.brushBits = brush;
    this.lastTap = { part, at: now };
    if (this.playing) this.app.game().sfx.play(1, ROAD_OF_BITS[bit], 3, 0.5);
  }
  copy() {
    const items = [...this.selection];
    if (!items.length) return;
    const t0 = Math.min(...items.map(it => it.t));
    this.clipboard = items.map(it => ({ kind: this.kindOf(it), item: JSON.parse(JSON.stringify(it)), dt: it.t - t0 }));
    this.status(`Copied ${items.length}`);
  }
  paste() {
    if (!this.clipboard) return;
    const at = this.snapTime(this.t);
    const added = [];
    this.edit(() => {
      for (const c of this.clipboard) {
        const it = { ...JSON.parse(JSON.stringify(c.item)), t: round3(at + c.dt) };
        this.level[c.kind].push(it);
        added.push(it);
      }
    });
    this.selection = new Set(added);
    this.inspect();
    this.status(`Pasted ${added.length}`);
  }
  nudge(dir) {
    if (!this.selection.size) return;
    const step = this.snap ? this.beat() / this.snap : 0.01;
    this.edit(() => { for (const it of this.selection) it.t = round3(Math.max(0, it.t + dir * step)); });
  }

  // ---------- flying the free camera in the preview ----------
  bindPreview() {
    const c = document.getElementById('screen');
    c.addEventListener('pointerdown', e => {
      if (!this.flyKey()) return;
      c.setPointerCapture(e.pointerId);
      this.fly = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, started: false };
    });
    c.addEventListener('contextmenu', e => { if (this.flyKey()) e.preventDefault(); });
    c.addEventListener('pointermove', e => {
      const f = this.fly, k = this.flyKey();
      if (!f || !k) return;
      const dx = e.clientX - f.x, dy = e.clientY - f.y;
      f.x = e.clientX; f.y = e.clientY;
      if (!f.started) { this.snapshot(); f.started = true; }
      const v = k.eye.map((a, i) => a - k.target[i]);
      const dist = Math.hypot(...v) || 1;
      if (f.pan) {
        const ws = this.app.renderer().view.ws;
        const right = [ws[0], ws[1], ws[2]], down = [ws[3], ws[4], ws[5]];
        const s = dist * 0.0016;
        for (let i = 0; i < 3; i++) { const d = (-dx * right[i] - dy * down[i]) * s; k.eye[i] += d; k.target[i] += d; }
      } else {
        let yaw = Math.atan2(v[0], v[2]);
        let pitch = Math.asin(clamp(v[1] / dist, -1, 1));
        yaw -= dx * 0.008;
        pitch = clamp(pitch + dy * 0.008, -1.45, 1.45);
        const nv = [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)];
        for (let i = 0; i < 3; i++) k.eye[i] = k.target[i] + nv[i];
      }
      k.eye = k.eye.map(Math.round); k.target = k.target.map(Math.round);
      this.dirty = true;
    });
    c.addEventListener('pointerup', () => { if (this.fly && this.fly.started) this.changed(); this.fly = null; });
    c.addEventListener('wheel', e => {
      const k = this.flyKey();
      if (!k) return;
      e.preventDefault();
      const now = performance.now();
      if (!this.wheelAt || now - this.wheelAt > 600) this.snapshot();
      this.wheelAt = now;
      const f = Math.exp(e.deltaY * 0.0012);
      if (e.altKey) k.fov = Math.round(clamp(k.fov * f, 40, 2000));
      else for (let i = 0; i < 3; i++) k.eye[i] = Math.round(k.target[i] + (k.eye[i] - k.target[i]) * f);
      this.changed();
    }, { passive: false });
  }
  // the camera key the preview flies: the one picked, with the song stopped
  flyKey() {
    if (!this.active || this.playing || !this.level) return null;
    const keys = this.selectedOf('keys');
    return keys.length === 1 && keys[0].mode === 'free' && this.selection.size === 1 ? keys[0] : null;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// how loud the song is, a hundred times a second (0 to 1)
function peaksOf(buffer) {
  const data = buffer.getChannelData(0);
  const per = Math.max(1, Math.floor(buffer.sampleRate / 100));
  const out = new Float32Array(Math.ceil(data.length / per));
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    for (let j = i * per, e = Math.min(data.length, j + per); j < e; j++) { const v = Math.abs(data[j]); if (v > m) m = v; }
    out[i] = m; if (m > max) max = m;
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}
