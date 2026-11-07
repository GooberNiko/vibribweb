// The title executable: the intro (the camera flying through the lines, then
// Vibri and the logo), the language and mode menus under it, and the kiosk
// demo scene. Everything runs frame by frame at the PAL rate, as the game did.
import { ModelMovie, CameraMovie } from './movie.js';

export const FPS = 50;
const DT = 1 / FPS;
const LOOP = 'loop', STOP = 'stop';
// a time of the scenes (in 30ths of a second) in frames of the game
const frames = t => (t === LOOP || t === STOP ? t : Math.floor(t * FPS / 30));
const perFrames = (perSecond, n) => Math.trunc(n * perSecond / FPS);

const JITTER_FALLING = -88, JITTER_RISING = -89, JITTER_CONSTANT = -90;
const JITTER_DEFAULT = 6;
const TITLE_TIME = 821; // when the title shows, at the end of the intro

// a model's look: how much its lines jitter
class Model {
  constructor(objects) { this.objects = objects; this.jitter = 0; }
}

// Model movies played one after the other, each on one of the element's models.
// When the scene is left, the lines scatter more and more.
class ModelElement {
  constructor(assets, cues, modelFiles, jitters) {
    this.frame = 0; this.cue = 0;
    this.models = modelFiles.map(f => { const m = new Model(assets.tmd(f)); m.jitter = JITTER_DEFAULT; return m; });
    this.cues = cues.map(c => ({ ...c, frame: frames(c.time) }));
    this.jitters = jitters;
    this.movies = [];
    for (let n = 0; n < this.cues.length - 1; n++) {
      const c = this.cues[n];
      this.movies[n] = { movie: new ModelMovie(this.models[c.model || 0].objects, assets.anm(c.file), this.cues[n + 1].frame === LOOP), model: this.models[c.model || 0] };
    }
    this.scatter = 20; this.scatterStep = -1;
  }
  updateJitter(frame, leaving) {
    let jitter = JITTER_DEFAULT;
    for (const j of this.jitters) {
      const start = frames(j.time), end = frames(j.time + j.length);
      if (frame >= start && frame <= end) {
        if (j.type === JITTER_CONSTANT) jitter = j.jitter;
        else {
          const t = j.type === JITTER_FALLING ? end - frame : frame - start;
          jitter = Math.trunc(t * j.jitter / (end - start));
        }
      }
      this.models[j.model].jitter = jitter;
    }
    if (leaving || this.scatter !== 0) {
      this.scatter += this.scatterStep;
      const s = perFrames(60, this.scatter);
      for (const m of this.models) m.jitter = jitter + s * s * 8;
      if (!leaving && this.scatter === 0) this.scatterStep = 1;
    }
  }
  update(r, leaving) {
    if (this.frame === 0) { this.scatter = 0; this.scatterStep = 1; }
    this.updateJitter(this.frame, leaving);
    const cues = this.cues;
    if (cues[this.cue].frame === STOP) return;
    const draw = this.frame >= cues[this.cue].frame;
    if (cues[this.cue + 1].frame === this.frame) this.cue++;
    const m = this.movies[this.cue];
    if (cues[this.cue + 1].frame === STOP && m.movie.finished) return;
    if (draw) m.movie.draw(r, null, DT, { jitter: m.model.jitter });
    this.frame++;
  }
  isFinished() {
    const last = this.cues.length - 1;
    if (this.cues[last].frame === LOOP) return false;
    return this.cue === last - 1 && this.movies[this.cue].movie.finished;
  }
  seek(label) {
    const i = this.cues.findIndex(c => c.file && c.label === label);
    if (i >= 0) { this.frame = this.cues[i].frame; this.cue = i; }
  }
  reset() { this.cue = 0; this.frame = 0; for (const m of this.movies) m.movie.rewind(); }
}

// Camera movies played one after the other.
class CameraElement {
  constructor(assets, cues) {
    this.frame = 0; this.cue = 0;
    this.cues = cues.map(c => ({ ...c, frame: frames(c.time) }));
    this.cameras = this.cues.slice(0, -1).map(c => new CameraMovie(assets.anc(c.file)));
  }
  update(r) {
    const cues = this.cues;
    if (cues[this.cue].frame === STOP) return;
    const show = this.frame >= cues[this.cue].frame;
    if (cues[this.cue + 1].frame === this.frame) this.cue++;
    if (show && this.cameras[this.cue]) this.cameras[this.cue].update(r, null, DT);
    this.frame++;
  }
  isFinished() {
    const last = this.cues.length - 1;
    if (this.cues[last].frame === LOOP) return false;
    return this.cue === last - 1 && this.cameras[this.cue].finished;
  }
  seek(label) {
    const i = this.cues.findIndex(c => c.file && c.label === label);
    if (i >= 0) { this.frame = this.cues[i].frame; this.cue = i; }
  }
  reset() { this.cue = 0; this.frame = 0; for (const c of this.cameras) c.rewind(); }
}

// Sounds played one after the other, on voice 0.
class SoundElement {
  constructor(sfx, cues) {
    this.sfx = sfx; this.frame = 0; this.cue = 0;
    this.cues = cues.map(c => ({ ...c, frame: frames(c.time) }));
  }
  update() {
    const c = this.cues[this.cue];
    if (c.frame === LOOP || c.frame === STOP) return;
    if (c.frame === this.frame) { this.cue++; this.sfx.play(c.sound >> 4, c.sound & 15, 0, 64 / 127, true); }
    this.frame++;
  }
  isFinished() { const c = this.cues[this.cue]; return c.frame === LOOP ? false : !this.sfx.isPlaying(0); }
  reset() { this.cue = 0; this.frame = 0; this.sfx.stop(0); }
  seek(label) {
    let i;
    for (i = 0; this.cues[i].sound > 0; i++) {
      const c = this.cues[i];
      if (c.label === label) { this.frame = c.frame; this.cue = i; this.sfx.play(c.sound >> 4, c.sound & 15, 0, 64 / 127, true); return; }
    }
    this.cue = i;
  }
}

// The logo, shown once the intro is over, and gone while the scene is left.
class LogoElement {
  constructor(assets) {
    this.frame = 0; this.start = frames(TITLE_TIME);
    this.movie = new ModelMovie(assets.tmd('MOVIE/TITLE/LOGO.TMD'), assets.anm('MOVIE/TITLE/LOGO.ANM'));
    this.scatter = 20; this.scatterStep = -1;
  }
  update(r, leaving) {
    if (this.frame === 0) { this.scatter = 0; this.scatterStep = 1; }
    if (++this.frame > this.start) {
      if (leaving) this.scatter += this.scatterStep;
      else if (this.scatter !== 0) { this.scatter += this.scatterStep; if (this.scatter === 0) this.scatterStep = 1; }
      this.movie.seek(0);
      if (this.scatter === 0) this.movie.draw(r, null, 0, { jitter: 0 });
    }
  }
  isFinished() { return true; }
  seek() { this.frame = this.start - 1; }
  reset() { this.frame = 0; this.movie.rewind(); }
}

class MovieScene {
  constructor() { this.elements = []; this.leaving = false; }
  add(e) { this.elements.push(e); return e; }
  update(r) { for (const e of this.elements) e.update(r, this.leaving); }
  isFinished() { return this.elements.every(e => e.isFinished()); }
  reset() { for (const e of this.elements) e.reset(); }
  seek(label) { this.reset(); for (const e of this.elements) e.seek(label); }
}

// The title: the intro, then the title and the logo. Confirm skips the intro.
export class TitleScene extends MovieScene {
  constructor(assets, sfx) {
    super();
    this.skippable = true; this.time = 0;
    const T = 'MOVIE/TITLE/';
    this.add(new CameraElement(assets, [
      { file: T + 'T01.ANC', time: 0 }, { file: T + 'T02.ANC', time: 446, label: 1 }, { time: LOOP },
    ]));
    this.add(new ModelElement(assets, [
      { file: T + 'T011.ANM', time: 0, model: 0 }, { file: T + 'T012.ANM', time: 115, model: 0 },
      { file: T + 'T013.ANM', time: 230, model: 0 }, { file: T + 'T014.ANM', time: 335, model: 0 },
      { file: T + 'T021.ANM', time: 446, model: 1 }, { file: T + 'T022.ANM', time: 497, model: 1 },
      { file: T + 'T03A.ANM', time: TITLE_TIME, model: 2, label: 1 }, { time: LOOP, label: -1 },
    ], [T + 'T01.TMD', T + 'T02.TMD', T + 'T03.TMD'], []));
    this.add(new ModelElement(assets, [
      { file: T + 'T022V.ANM', time: 497 }, { file: T + 'V_TITLE.ANM', time: TITLE_TIME, label: 1 }, { time: LOOP, label: -1 },
    ], [T + 'VIBRI.TMD'], []));
    this.add(new LogoElement(assets));
    this.add(new SoundElement(sfx, [{ sound: 0x110, time: 0 }, { sound: 0x111, time: 446, label: 1 }, { sound: 0x112, time: 497 }, { sound: -1, time: LOOP }]));
  }
  seek(label) { super.seek(label); this.time = frames(TITLE_TIME); }
  introOver() { return this.time > frames(TITLE_TIME); }
  leave() { this.leaving = true; }
  update(r, confirm) {
    if (this.time >= frames(TITLE_TIME)) this.skippable = false;
    if (this.skippable && confirm) this.seek(1);
    super.update(r);
    if (this.time < 3000) this.time++;
  }
}

// The kiosk demo: Vibri, the road and its obstacles, in three scenes to one of the disc's songs.
const K1S2 = 480, K2 = 938, K2S2 = 1496, K3 = 2104, K3S2 = 2515, KEND = 3025;
export class KioskScene extends MovieScene {
  constructor(assets, sfx) {
    super();
    this.sfx = sfx;
    const K = n => `MOVIE/KIOSK${n}/`;
    this.add(new CameraElement(assets, [
      { file: K(1) + 'K1_01.ANC', time: 0, label: 0 }, { file: K(1) + 'K1_02.ANC', time: K1S2 },
      { file: K(2) + 'K2_01.ANC', time: K2, label: 1 }, { file: K(2) + 'K2_02.ANC', time: K2S2 },
      { file: K(3) + 'K3_01.ANC', time: K3, label: 2 }, { file: K(3) + 'K3_02.ANC', time: K3S2 },
      { time: STOP, label: 3 },
    ]));
    const shots = (kind, model) => [
      { file: K(1) + `K1_${kind}01.ANM`, time: 0, model: model[0] }, { file: K(1) + `K1_${kind}02.ANM`, time: K1S2, model: model[0] },
      { file: K(2) + `K2_${kind}01.ANM`, time: K2, model: model[1] }, { file: K(2) + `K2_${kind}02.ANM`, time: K2S2, model: model[1] },
      { file: K(3) + `K3_${kind}01.ANM`, time: K3, model: model[2] }, { file: K(3) + `K3_${kind}02.ANM`, time: K3S2, model: model[2] },
      { time: STOP, label: 3 },
    ];
    const J = (model, time, length, jitter, type) => ({ model, time, length, jitter, type });
    this.add(new ModelElement(assets, shots('V', [0, 0, 0]), [K(2) + 'MODEL.TMD'], [
      J(0, 0, 20, 1600, JITTER_FALLING), J(0, 480, 120, 40, JITTER_CONSTANT), J(0, K2 - 21, 20, 1600, JITTER_RISING),
      J(0, K2, 20, 1600, JITTER_FALLING), J(0, K3 - 21, 20, 600, JITTER_RISING), J(0, K3, 20, 1600, JITTER_FALLING),
      J(0, KEND - 21, 40, 1000, JITTER_RISING),
    ]));
    this.add(new ModelElement(assets, shots('R', [0, 1, 2]), [K(1) + 'K1_RD.TMD', K(2) + 'K2_RD.TMD', K(3) + 'K3_RD.TMD'], [
      J(0, 0, 20, 1600, JITTER_FALLING), J(0, 480, 120, 40, JITTER_CONSTANT), J(0, 600, 30, 60, JITTER_FALLING),
      J(0, 630, 30, 60, JITTER_FALLING), J(0, K2 - 21, 20, 1600, JITTER_RISING), J(1, K2, 20, 1600, JITTER_FALLING),
      J(1, K3 - 21, 20, 600, JITTER_RISING), J(2, K3, 20, 1600, JITTER_FALLING), J(2, KEND - 21, 40, 1000, JITTER_RISING),
    ]));
    this.add(new ModelElement(assets, shots('P', [0, 1, 2]), [K(1) + 'K1_PT.TMD', K(2) + 'K2_PT.TMD', K(3) + 'K3_PT.TMD'], [
      J(0, K2 - 21, 20, 1600, JITTER_RISING), J(1, K2, 20, 1600, JITTER_FALLING), J(1, K3 - 21, 20, 600, JITTER_RISING),
      J(2, K3, 20, 1600, JITTER_FALLING), J(2, 3030, 20, 1000, JITTER_RISING),
    ]));
    this.add(new ModelElement(assets, [{ file: K(1) + 'K1_F02.ANM', time: K1S2 }, { time: STOP, label: -1 }], [K(1) + 'FROG.TMD'], [J(0, 600, 30, 60, JITTER_FALLING)]));
    this.add(new ModelElement(assets, [{ file: K(1) + 'K1_S02.ANM', time: K1S2 }, { time: STOP, label: -1 }], [K(1) + 'SNAKE.TMD'], [J(0, 630, 30, 60, JITTER_FALLING)]));
    this.add(new SoundElement(sfx, [{ sound: 0x100, time: 0 }, { sound: -1, time: STOP }]));
  }
  // the confirm or the cancel button ends it sooner: the lines scatter while the confirm sound plays
  isFinished(pressed) {
    if (!this.leaving && pressed) { this.leaving = true; this.sfx.play(0, 0, 1, 64 / 127, true); }
    if (this.leaving && !this.sfx.isPlaying(1)) return true;
    return super.isFinished();
  }
}

// The language and mode menus: a model per menu, moved to the cursor's item
// by a movie, and a second movie zooming between the menus.
export const MENU = { LANGUAGE: 0, MODE: 1, START: 2, NONE: 3 };
export const LANG_RESULT = { NONE: 0, LANGUAGE: 1, PLAY: 6, KIOSK: 7, BACK: 8, STARTED: 9 };
// the languages in two rows (French is wider); where the cursor goes for each
const LANGUAGE_CELLS = [0, 1, 2, 3, 3, 4];
const LANGUAGE_POSITIONS = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1]];

export class LanguageSelect {
  constructor(assets, sfx) {
    this.assets = assets; this.sfx = sfx;
    this.resetTransition();
    this.next = MENU.NONE; this.current = MENU.NONE; this.result = 0; this.chosen = false;
    this.language = [0, 0]; this.mode = 0;
    this.loadMenus();
  }
  loadMenus() {
    const a = this.assets;
    this.models = [new Model(a.tmd('MENU/LANG/LANG.TMD')), new Model(a.tmd('MENU/MODE/MODE.TMD'))];
    for (const m of this.models) m.jitter = 10;
    this.select = ['LANG', 'MODE'].map((n, i) => { const mv = new ModelMovie(this.models[i].objects, a.anm(`MENU/${n}/SELECT.ANM`)); mv.setSpeed(0); return mv; });
    this.scale = ['LANG', 'MODE'].map((n, i) => new ModelMovie(this.models[i].objects, a.anm(`MENU/${n}/SCALE.ANM`)));
  }
  resetTransition() { this.busy = false; this.frame = 0; this.reversed = false; this.drawn = false; this.closing = false; }
  setModeJitter(frame) { const t = perFrames(120, frame); this.models[MENU.MODE].jitter = t * t * 7 + 10; }
  drawMovie(r, i, movie) { movie.draw(r, null, DT, { jitter: this.models[i].jitter }); }
  updateTransition(r) {
    if (!this.busy) { this.drawn = false; return; }
    if (this.next === MENU.START) {
      this.setModeJitter(this.frame++);
      // (the confirm sound has ended; or, with the browser's audio still asleep, it never will)
      if (!this.sfx.isPlaying(1) || this.frame > 2 * FPS) { this.busy = false; this.result = LANG_RESULT.STARTED; this.current = this.next; }
    } else if (this.closing) {
      this.setModeJitter(this.frame--);
      if (this.frame === 0) { this.models[MENU.MODE].jitter = 10; this.busy = false; this.closing = false; }
    } else if (this.current === MENU.NONE) {
      this.current = this.next; this.busy = false;
    } else {
      this.drawn = true;
      const s = this.scale[this.current];
      this.drawMovie(r, this.current, s);
      if (s.finished) {
        this.reversed = !this.reversed;
        this.current = this.next;
        const next = this.scale[this.current];
        next.rewind(this.reversed);
        next.setSpeed(this.reversed ? -1 : 1);
        this.busy = this.reversed;
      }
    }
  }
  playSounds(input) {
    if (input.moved && input.changed) this.sfx.play(0, 6, 5, 64 / 127, true);
    if (input.confirm) this.sfx.play(0, 0, 1, 64 / 127, true);
  }
  // the cursor of a menu (no wrapping); a wider item is skipped over in one move
  readLanguage(keys) {
    const [x0, y0] = this.language;
    const item = (x, y) => LANGUAGE_CELLS[y * 3 + x];
    const from = item(x0, y0);
    let x = x0, y = y0;
    const dx = keys.right ? 1 : keys.left ? -1 : 0, dy = keys.down ? 1 : keys.up ? -1 : 0;
    x = Math.max(0, Math.min(2, x + dx)); y = Math.max(0, Math.min(1, y + dy));
    if (item(x, y) === from && (x !== x0 || y !== y0)) x = Math.max(0, Math.min(2, x + dx));
    this.language = [x, y];
    return { confirm: keys.confirm, moved: !!(dx || dy), changed: item(x, y) !== from };
  }
  readMode(keys) {
    const from = this.mode;
    if (keys.down) this.mode = Math.min(2, this.mode + 1);
    else if (keys.up) this.mode = Math.max(0, this.mode - 1);
    return { confirm: keys.confirm, moved: !!(keys.up || keys.down || keys.left || keys.right), changed: this.mode !== from };
  }
  update(r, keys) {
    this.updateTransition(r);
    if (this.current === MENU.LANGUAGE) {
      if (!this.busy && !this.chosen) {
        const input = this.readLanguage(keys);
        this.playSounds(input);
        const item = LANGUAGE_CELLS[this.language[1] * 3 + this.language[0]];
        this.select[MENU.LANGUAGE].seek(item);
        if (input.confirm) this.result = LANG_RESULT.LANGUAGE + item;
        this.drawMovie(r, MENU.LANGUAGE, this.select[MENU.LANGUAGE]);
      }
    } else if (this.current === MENU.MODE) {
      if (!this.busy && !this.chosen) {
        const input = this.readMode(keys);
        this.playSounds(input);
        this.select[MENU.MODE].seek(this.mode);
        if (input.confirm) this.result = LANG_RESULT.PLAY + this.mode;
      }
      if (!this.drawn) this.drawMovie(r, MENU.MODE, this.select[MENU.MODE]);
    }
  }
  show(menu) {
    if (menu === MENU.MODE) this.loadMenus();
    this.next = menu;
    this.busy = true;
    if (menu === MENU.START) this.frame = 0;
    this.result = 0; this.chosen = false;
  }
  setLanguageCursor(index) { const p = LANGUAGE_POSITIONS[index] || [1, 0]; this.language = [p[0], p[1]]; }
  choose(result) { this.playSounds({ confirm: true }); this.chosen = true; this.result = result; }
  // back on the title: the mode menu, its lines settling
  close() { this.busy = true; this.frame = 20; this.closing = true; this.current = MENU.MODE; }
}

// What the title executable's main loop did: the title scene and the menus
// under it, the language chosen first, then the game or the kiosk demo.
export class Intro {
  constructor({ assets, sfx, firstRun, languages, languageIndex, returning }) {
    this.assets = assets; this.sfx = sfx;
    this.title = new TitleScene(assets, sfx);
    this.menus = new LanguageSelect(assets, sfx);
    this.languages = languages;
    this.firstRun = firstRun;
    if (languages) this.menus.setLanguageCursor(languageIndex);
    if (returning) { this.menus.close(); this.title.seek(1); }
    this.introOver = false; this.inLanguageMenu = false;
    this.next = null;   // 'game' or 'kiosk'
    this.idle = 0;
    this.keys = blank();
  }
  press(key) { this.keys[key] = 1; }
  // the language's own files (the mode menu's words)
  setAssets(assets) { this.menus.assets = assets; }
  // one frame; returns {language}, {start: 'game' | 'kiosk' | 'demo'} or null
  step(r, canDemo) {
    const keys = this.keys;
    this.keys = blank();
    const any = Object.values(keys).some(Boolean);
    let out = null;
    this.title.update(r, keys.confirm || keys.back);
    this.menus.update(r, keys);
    if (!this.introOver && this.title.introOver()) {
      this.introOver = true;
      this.menus.show(this.firstRun && this.languages ? MENU.LANGUAGE : MENU.MODE);
      this.inLanguageMenu = this.firstRun && this.languages;
    }
    const result = this.menus.result;
    if (result >= LANG_RESULT.LANGUAGE && result < LANG_RESULT.LANGUAGE + 5) {
      this.inLanguageMenu = false;
      out = { language: result - LANG_RESULT.LANGUAGE };
      this.menus.result = 0;
      this.pendingMode = true; // shown once the language's files are in
    } else if (result === LANG_RESULT.BACK) {
      if (this.languages) { this.menus.show(MENU.LANGUAGE); this.inLanguageMenu = true; }
      else this.menus.result = 0;
    } else if (result === LANG_RESULT.KIOSK || result === LANG_RESULT.PLAY) {
      this.menus.show(MENU.START);
      this.title.leave();
      this.next = this.demo ? 'demo' : result === LANG_RESULT.KIOSK ? 'kiosk' : 'game';
    } else if (result === LANG_RESULT.STARTED) {
      out = { start: this.next };
    }
    if (any) this.idle = 0;
    // left alone: a demo
    if (canDemo && !this.inLanguageMenu && !this.demoStarted && ++this.idle > 96 * FPS) {
      const demo = canDemo();
      if (!demo) this.idle = 0;
      else {
        this.demoStarted = true;
        this.menus.choose(demo === 'kiosk' ? LANG_RESULT.KIOSK : LANG_RESULT.PLAY);
        this.demo = demo === 'kiosk' ? null : demo;
      }
    }
    return out;
  }
  // the language's files are in: on to the mode menu
  languageSet() { if (this.pendingMode) { this.pendingMode = false; this.menus.show(MENU.MODE); } }
}

function blank() { return { up: 0, down: 0, left: 0, right: 0, confirm: 0, back: 0 }; }
