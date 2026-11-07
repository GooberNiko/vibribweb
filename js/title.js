// The game's own screens around the courses: the menus, each a line model whose
// cursor moves by a movie from one item to the next, Vibri lying, sitting or
// standing beside it and saying the items; the results of a course (cleared:
// the score counted, a medal and the score said; lost: "game over" and Vibri's
// comment), the high scores, and the camera swinging and the lines scattering
// as one screen fades into the next. One step() is one PAL frame of the game.
import { ModelMovie, CameraMovie, lookAlongZ, lookAlongFixed } from './movie.js';
import { SoundSequence } from './audio.js';
import { mul, translation } from './render.js';
import { toMarks } from './gameplay.js';
import { readGameTexts } from './formats.js';

export const SCREEN = {
  NONE: 0, MAIN: 1, PSJ: 2, UNKNOWN: 3, SPEED: 4, CD: 5, TRACK: 6, OPTION: 10,
  PSJ_HISCORE: 11, UNKNOWN_HISCORE: 12, CLEAR: 13, AGAIN: 14, AGAIN_SELECT: 15, DONE: 16,
};
export const RESULT = {
  PSJ_MODES: 1, UNKNOWN_MODES: 2, OPTIONS: 3, LEAVE: 4,
  BRONZE: 5, SILVER: 6, GOLD: 7, PSJ_HISCORES: 8, PSJ_BACK: 9,
  ONE_TRACK: 10, ALL_TRACKS: 11, SPEED_MODES: 12, IN_ORDER: 13, UNKNOWN_HISCORES: 14, UNKNOWN_BACK: 15,
  SPEED_1: 16, SPEED_2: 17, SPEED_3: 18, SPEED_BACK: 19,
  CHANGE_CD: 23, CD_CHANGED: 24, CD_CHANGE_BACK: 25, TRACK_BACK: 26, TRACK_CHOSEN: 27,
  OPTION_BACK: 34, HISCORE_BACK: 35, AGAIN: 36, AGAIN_BACK: 37, RESULTS_DONE: 38,
};
// the courses as the game numbers them
export const COURSE = { BRONZE: 0, SILVER: 1, GOLD: 2, ONE_TRACK: 3, ALL_TRACKS: 4, SPEED_1: 5, SPEED_2: 6, SPEED_3: 7, IN_ORDER: 8 };

const FPS = 50;                       // the logic runs at the PAL frame rate
const DT = 1 / FPS;
const F = sixtieths => Math.trunc(FPS * sixtieths / 60);
const FADE_FRAMES = F(20);
const MENU_JITTER = 5;
const TEXT_JITTER = 11;
const JAPANESE = 5;
// the music of each screen (stopped going to a screen with other music)
const SCREEN_MUSIC = [0, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 0, 0, 32, 0];

// Vibri's poses: lying, sitting, standing, each with its speaking movie
const LYING = 0, SITTING = 2, STANDING = 4, PAUSED = 6, HIDDEN = 7;

// the models, in title/
const M = {
  VIBRI: 0, SPEED: 1, CD: 2, TRACK: 3, ALERT: 4, OPTION: 5, AGAIN: 6, HISCORE: 7, CLEAR_OVER: 8,
  MAIN: 9, PSJ: 10, UNKNOWN: 11, CLEAR_SONG: 12, SPEED_METER: 13, SPEED_SCRIBBLE: 14,
};
const MODEL_FILES = [
  'VIBRI/VIBRI', 'SPEED/MD_SPD', 'CD/CD', 'TRK/TRK', 'AL/AL', 'OPTION/OP', 'AGAIN/AG', 'HISCORE/HI', 'END/CL_OV',
  'MA/MA', 'MODE/MDV', 'MODE/MDU', 'END/CLR_SONG', 'END/SPD_MTR', 'END/SPD_MOJA',
];
// the movies, by the game's numbers, and the model each moves
const MOVIE_FILES = [
  'VIBRI/MN_V01A', 'VIBRI/MN_V01B', 'VIBRI/MN_V02A', 'VIBRI/MN_V02B', 'VIBRI/MN_V03A', 'VIBRI/MN_V03B',
  'V_CL/CLR_V04', 'V_CL/CLR_V05', 'V_CL/CLR_V12', 'V_CL/CLR_V14', 'V_CL/CLR_V15', 'V_CL/CLR_V16',
  'V_OV/GOV_V03A', 'V_OV/GOV_V03B', 'V_OV/GOV_V03C', 'V_OV/GOV_V05', 'V_OV/GOV_V06A', 'V_OV/GOV_V06B', 'V_OV/GOV_V07',
  'V_OV/GOV_V01', 'V_OV/SPD_V02', 'V_OV/SPD_V03',
  'V_SONG/V01', 'V_SONG/V02', 'V_SONG/V03A', 'V_SONG/V03B', 'V_SONG/V04', 'V_SONG/V05A', 'V_SONG/V05B', 'V_SONG/V06', 'V_SONG/V07', 'V_SONG/V08',
  'V_CL/S_V01', 'V_CL/S_V02', 'V_CL/S_V03', 'V_CL/S_V04', 'V_CL/S_V05', 'V_CL/S_V06', 'V_CL/S_V07',
  'SPEED/SPD01_02', 'SPEED/SPD02_03', 'SPEED/SPD03_04', 'SPEED/SPD04_01', 'SPEED/OPEN', 'SPEED/CLOSE',
  'CD/CD-12', 'CD/CD-23', 'CD/CD-31', 'CD/OPEN', 'CD/CLOSE',
  'TRK/TRK_L', 'TRK/TRK_R', 'TRK/TRK_EXIT', 'AL/AL_ROT',
  'OPTION/OP01_02', 'OPTION/OP02_03', 'OPTION/OP03_01', 'OPTION/OPEN', 'OPTION/CLOSE',
  'AGAIN/AG_12', 'AGAIN/AG_21', 'AGAIN/CLOSE',
  'HISCORE/HI1_OPEN', 'HISCORE/HI1_LOOP', 'HISCORE/HI2_L', 'HISCORE/HI2_R', 'HISCORE/HI2_EX',
  'END/CLR_01', 'END/G_OV_01', 'END/G_OV_02', 'END/G_OV_03', 'END/G_OV_04', 'END/SPD_G02', 'END/S_TEN02',
  'MA/MA12', 'MA/MA23', 'MA/MA34', 'MA/MA41',
  'MODE/MDV12', 'MODE/MDV23', 'MODE/MDV34', 'MODE/MDV45', 'MODE/MDV51', 'MODE/MDV_OP', 'MODE/MDV_CL',
  'MODE/MDU12', 'MODE/MDU23', 'MODE/MDU34', 'MODE/MDU45', 'MODE/MDU56', 'MODE/MDU61', 'MODE/MDU_OP', 'MODE/MDU_CL',
  'END/SONG_01', 'END/SONG_TEN', 'END/S_MTR01', 'END/S_KEM01', 'END/S_KEM02', 'END/SPD_M01', 'END/SPD_M02',
  'V_CL/CLR_V00', 'END/CLR_00',
];
const MOVIE_MODELS = [
  ...Array(39).fill(M.VIBRI), ...Array(6).fill(M.SPEED), ...Array(5).fill(M.CD), ...Array(3).fill(M.TRACK), M.ALERT,
  ...Array(5).fill(M.OPTION), ...Array(3).fill(M.AGAIN), ...Array(5).fill(M.HISCORE), ...Array(7).fill(M.CLEAR_OVER),
  ...Array(4).fill(M.MAIN), ...Array(7).fill(M.PSJ), ...Array(8).fill(M.UNKNOWN), M.CLEAR_SONG, M.CLEAR_SONG,
  M.SPEED_METER, M.SPEED_METER, M.SPEED_METER, M.SPEED_SCRIBBLE, M.SPEED_SCRIBBLE, M.VIBRI, M.CLEAR_OVER,
];
const LOOPING = [0, 1, 6, 13, 17, 2, 3, 4, 5, 53, 63, 93, 35];
const CAMERA_FILES = ['C_L', 'R_C', 'ZOOM_IN', 'SONG_01', 'SONG_02', 'SONG_03A', 'SONG_03B', 'SONG_04', 'SONG_06', 'SONG_07', 'SONG_08', 'SONG_05A', 'SONG_05B', 'MA_CAM'];
// SetCamera() cues: [camera, backwards]
const CUES = [[0, false], [0, true], [1, false], [1, true], [2, false], [2, true]];

// The menus. up[i]: the movie played backwards to reach item i going up; down[i]: forwards going down.
const MENUS = {
  [SCREEN.MAIN]: {
    model: M.MAIN, items: 4, back: 3, pose: LYING, volume: 64,
    up: [74, 75, 76, 77], down: [77, 74, 75, 76],
    sounds: [[240, 241, 126], [125, 243, 126], [119], [96]],
    results: [RESULT.PSJ_MODES, RESULT.UNKNOWN_MODES, RESULT.OPTIONS, RESULT.LEAVE],
  },
  [SCREEN.PSJ]: {
    model: M.PSJ, items: 5, back: 4, pose: SITTING, volume: 90, open: 83, close: 84, parent: SCREEN.MAIN,
    up: [78, 79, 80, 81, 82], down: [82, 78, 79, 80, 81],
    sounds: [[114], [113], [112], [128], [96]],
    results: [RESULT.BRONZE, RESULT.SILVER, RESULT.GOLD, RESULT.PSJ_HISCORES, RESULT.PSJ_BACK],
  },
  [SCREEN.UNKNOWN]: {
    model: M.UNKNOWN, items: 6, back: 5, pose: SITTING, volume: 64, open: 91, close: 92, parent: SCREEN.MAIN,
    up: [85, 86, 87, 88, 89, 90], down: [90, 85, 86, 87, 88, 89],
    sounds: [[115, 120], [117, 120], [116], [118], [128], [96]],
    results: [RESULT.ONE_TRACK, RESULT.ALL_TRACKS, RESULT.SPEED_MODES, RESULT.IN_ORDER, RESULT.UNKNOWN_HISCORES, RESULT.UNKNOWN_BACK],
  },
  [SCREEN.SPEED]: {
    model: M.SPEED, items: 4, back: 3, pose: LYING, volume: 90, open: 43, close: 44, parent: SCREEN.UNKNOWN,
    up: [39, 40, 41, 42], down: [42, 39, 40, 41],
    sounds: [[114], [113], [112], [96]],
    results: [RESULT.SPEED_1, RESULT.SPEED_2, RESULT.SPEED_3, RESULT.SPEED_BACK],
  },
  [SCREEN.CD]: {
    model: M.CD, items: 3, back: 2, pose: SITTING, volume: 64, open: 48, close: 49, start: 1,
    up: [45, 46, 47], down: [47, 45, 46],
    sounds: [[246, 247], [246, 248], [96]],
    results: [RESULT.CHANGE_CD, RESULT.CD_CHANGED, RESULT.CD_CHANGE_BACK],
  },
  [SCREEN.OPTION]: {
    model: M.OPTION, items: 3, back: 2, pose: SITTING, volume: 90, open: 57, close: 58, alwaysOpen: true,
    up: [54, 55, 56], down: [56, 54, 55],
    sounds: [[129], [130], [96]],
    results: [0, 0, RESULT.OPTION_BACK],
  },
};

// Shows one of a model's objects in place of another: objects[0] is the one
// replaced, objects[n] the one shown for n (0: itself).
class ObjectSwap {
  constructor(model, objects) { this.model = model; this.objects = objects; this.original = model[objects[0]]; }
  show(n) { this.model[this.objects[0]] = n === 0 ? this.original : this.model[this.objects[n]]; }
}
const digitsOf = (first, digits, unit) => first.map(f => [f, ...digits, ...(unit !== undefined ? [unit] : [])]);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export class Title {
  constructor(assets, sfx) {
    this.assets = assets;
    this.lang = assets.languageIndex ?? 1;
    this.models = MODEL_FILES.map(f => assets.tmd(`TITLE/${f}.TMD`).slice());
    this.movies = MOVIE_FILES.map((f, i) => {
      const mv = new ModelMovie(this.models[MOVIE_MODELS[i]], assets.anm(`TITLE/${f}.ANM`), LOOPING.includes(i));
      mv.modelIndex = MOVIE_MODELS[i];
      return mv;
    });
    this.cameras = CAMERA_FILES.map(f => new CameraMovie(assets.anc(`TITLE/CAM/${f}.ANC`)));
    this.cameras[13].loop = true;
    this.font = assets.tmd('FONT/FONT.TMD');
    this.texts = assets.texts ? assets.texts() : readGameTexts(null);
    // the look of the models: their jitter, an object's own, the objects hidden
    this.modelJitter = this.models.map(() => MENU_JITTER);
    this.objectJitter = new Map();
    this.hidden = new Set();
    // the signs
    const m = this.models;
    this.optionObjects = m[M.OPTION].slice();
    this.againCourseSign = new ObjectSwap(m[M.AGAIN], [3, 6, 7, 8, 9, 10, 14]);
    this.againSpeedSign = new ObjectSwap(m[M.AGAIN], [15, 11, 12, 13]);
    this.courseSign = new ObjectSwap(m[M.HISCORE], [6, 47, 44, 45, 43, 46]);
    this.speedSign = new ObjectSwap(m[M.HISCORE], [5, 40, 41, 42]);
    const digits = range(52, 61);
    this.scoreDigits = digitsOf(range(31, 36), digits, 63).map(o => new ObjectSwap(m[M.CLEAR_OVER], o));
    this.bonusDigits = digitsOf(range(0, 5), digits).map(o => new ObjectSwap(m[M.CLEAR_OVER], o));
    this.totalDigits = digitsOf(range(11, 16), digits).map(o => new ObjectSwap(m[M.CLEAR_OVER], o));
    this.songTotalDigits = digitsOf(range(14, 19), range(2, 11)).map(o => new ObjectSwap(m[M.CLEAR_SONG], o));
    const hi = range(28, 37);
    this.firstScoreDigits = digitsOf(range(8, 13), hi, 39).map(o => new ObjectSwap(m[M.HISCORE], o));
    this.secondScoreDigits = digitsOf(range(14, 19), hi, 39).map(o => new ObjectSwap(m[M.HISCORE], o));
    this.thirdScoreDigits = digitsOf(range(20, 25), hi, 39).map(o => new ObjectSwap(m[M.HISCORE], o));
    this.marks = range(21, 27).map(f => new ObjectSwap(m[M.CLEAR_OVER], [f, ...range(37, 51)]));
    this.commentSign = new ObjectSwap(m[M.CLEAR_OVER], [10, 7, 8, 9]);
    this.speedMeterSign = new ObjectSwap(m[M.SPEED_METER], [4, 5, 6]);

    this.voices = new SoundSequence(sfx, 1);
    this.music = new SoundSequence(sfx, 0);
    this.sfx = sfx;
    this.cursors = {};
    for (const s of Object.keys(MENUS)) this.cursors[s] = MENUS[s].start || 0;
    this.cursors[SCREEN.TRACK] = 0;
    this.cursors[SCREEN.AGAIN_SELECT] = 0;
    this.cursors.back = 0;
    this.screen = SCREEN.NONE; this.next = SCREEN.NONE; this.previous = SCREEN.NONE;
    this.fadeFrame = 0; this.fadeStep = 0; this.fade = 'none';
    this.vibriState = HIDDEN; this.vibriMovie = 0; this.vibriFrame = 0;
    this.cameraCue = -1;
    this.menuMovie = 74; this.speed = 0;
    this.entering = false; this.leaving = false; this.waitFrame = 0;
    this.track = 1; this.numTracks = 1;
    this.options = { soundEffects: 1, vibration: 1 };
    this.onTrack = null; this.onOptions = null;
    this.acc = 0;
    this.keys = blankKeys();
    // the results: what the course gave (setResults())
    this.results = { course: 0, score: 0, bonus: 0, seconds: 0, comment: 0, rank: 0, timeUp: false };
    this.highScores = new Array(27).fill(0);
    this.medal = 2; this.passScore = 2500;
    this.hiscoreCourse = 0; this.unknownCourse = 0;
    this.voiceLine = sayNumber(1, 1);
  }

  // what the screens show after a course
  setResults(r) { Object.assign(this.results, r); this.results.speed = r.course >= COURSE.SPEED_1 && r.course <= COURSE.SPEED_3; }

  // fades to `screen`
  goTo(screen) {
    this.fadeFrame = 0;
    this.fadeStep = 1;
    this.next = screen;
    this.previous = this.screen;
    if (SCREEN_MUSIC[this.screen] && SCREEN_MUSIC[screen] !== SCREEN_MUSIC[this.screen]) this.music.stop();
    if (screen === SCREEN.DONE || screen === SCREEN.NONE) this.music.stop();
  }
  // shows `screen` at once
  show(screen) {
    this.previous = SCREEN.NONE;
    this.screen = this.next = screen;
    this.fadeFrame = FADE_FRAMES; this.fadeStep = -1; this.fade = 'in';
    this.arrive();
  }
  stop() { this.music.stop(); this.voices.stop(); this.screen = this.next = SCREEN.NONE; }
  isActive() { return this.screen !== SCREEN.NONE && this.screen !== SCREEN.DONE; }

  press(key) { this.keys[key] = 1; }

  // how many frames of the game are due after `dt` seconds (at most 5)
  frames(dt) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= DT && n < 5) { this.acc -= DT; n++; }
    if (n === 5) this.acc = 0;
    return n;
  }

  // one frame of the game: what happens on the screen, then it drawn; returns a RESULT or 0
  step(r) {
    this.fadeFrame += this.fadeStep;
    const arrived = this.fadeFrame === FADE_FRAMES && this.fadeStep === 1;
    if (this.fadeFrame >= FADE_FRAMES) { this.screen = this.next; this.fadeFrame = FADE_FRAMES; this.fadeStep = -1; }
    else if (this.fadeFrame <= 0) { this.fadeFrame = 0; this.fadeStep = 0; }
    this.fade = this.fadeStep > 0 ? 'out' : this.fadeStep < 0 ? 'in' : 'none';
    if (arrived) this.arrive();
    this.still = this.fadeFrame === 0;
    const jitter = this.fadeFrame * 200;

    const keys = this.keys;
    this.keys = blankKeys();
    let result = 0;
    const s = this.screen;
    if (s === SCREEN.TRACK) result = this.tickTrack(keys);
    else if (MENUS[s]) result = this.tickMenu(MENUS[s], keys);
    this.tickVibri();
    if (s === SCREEN.CLEAR) result = this.drawClear(r, jitter, keys);
    else if (s === SCREEN.AGAIN) result = this.drawAgain(r, jitter, keys);
    else if (s === SCREEN.AGAIN_SELECT) result = this.drawAgainSelect(r, jitter, keys);
    else if (s === SCREEN.PSJ_HISCORE) result = this.drawHiscore(r, jitter, this.previous === SCREEN.CLEAR || this.previous === SCREEN.AGAIN ? false : this.still, 0, keys);
    else if (s === SCREEN.UNKNOWN_HISCORE) result = this.drawUnknownHiscore(r, jitter, keys);
    else this.draw(r, DT, jitter);
    if (this.fade === 'out') result = 0;
    return result;
  }

  arrive() {
    const s = this.screen;
    this.leaving = false; this.waitFrame = 0;
    for (const m of this.movies) m.rewind();
    if (s === SCREEN.CLEAR) { this.arriveClear(); return; }
    if (s === SCREEN.AGAIN) { this.arriveAgain(); return; }
    if (s === SCREEN.AGAIN_SELECT) { this.arriveAgainSelect(); return; }
    if (s === SCREEN.PSJ_HISCORE) { this.arriveHiscore(0); return; }
    if (s === SCREEN.UNKNOWN_HISCORE) { this.arriveUnknownHiscore(); return; }
    this.voices.stop();
    if (s === SCREEN.TRACK) {
      this.vibriState = STANDING;
      this.music.play(32, 90);
      this.track = 1;
      this.onTrack && this.onTrack(1);
      this.cursors[SCREEN.TRACK] = 0;
      this.menuMovie = 50; this.speed = 0;
      this.setCamera(4);
      this.voiceLine = sayNumber(1, 1);
      return;
    }
    const m = MENUS[s];
    if (!m) return;
    this.music.play(32, 90);
    this.vibriState = m.pose;
    if (s === SCREEN.MAIN) {
      if (this.cursors[s] === m.back) this.cursors[s] = 0;
      this.entering = false;
      this.setCamera(1);
    } else if (m.alwaysOpen || this.previous === m.parent || (s === SCREEN.CD && this.previous !== SCREEN.TRACK)) {
      this.cursors[s] = m.start || 0;
      this.entering = true;
      this.setCamera(2);
    } else {
      if (s === SCREEN.CD && this.cursors[s] === m.back) this.cursors[s] = 1;
      this.entering = false;
      this.setCamera(1);
    }
    if (s === SCREEN.OPTION) this.showOptions();
    this.menuMovie = m.up[this.cursors[s]];
    this.speed = 0;
  }

  setCamera(cue) {
    this.cameraCue = cue;
    if (cue < 0) return;
    for (const c of this.cameras) { c.rewind(); c.setSpeed(1); }
    const [cam, backwards] = CUES[cue];
    this.cameras[cam].rewind(backwards);
    this.cameras[cam].setSpeed(backwards ? -1 : 1);
  }
  updateCamera(r, cue) { if (cue >= 0) this.cameras[CUES[cue][0]].update(r, null, DT); }

  speak(sounds, volume) {
    this.vibriState = { [LYING]: 1, [SITTING]: 3, [STANDING]: 5 }[this.poseOf()] ?? 1;
    this.voices.play(sounds, volume);
  }
  poseOf() {
    const s = this.vibriState;
    if (s === PAUSED) return [LYING, LYING, SITTING, SITTING, STANDING, STANDING][this.vibriMovie];
    return s - (s % 2);
  }

  // the cursor of a column of items: the back key goes to the back item
  readCursor(screen, items, back, keys, active, wrap = true) {
    const from = this.cursors[screen];
    const out = { up: 0, down: 0, left: 0, right: 0, confirm: 0, back: 0, changed: 0 };
    if (!active) return out;
    if (keys.confirm) out.confirm = 1;
    else if (keys.back && back >= 0) { out.back = from !== back ? 1 : 0; this.cursors[screen] = back; }
    const at = this.cursors[screen];
    if (keys.up) { out.up = 1; this.cursors[screen] = wrap ? (at + items - 1) % items : Math.max(0, at - 1); }
    else if (keys.down) { out.down = 1; this.cursors[screen] = wrap ? (at + 1) % items : Math.min(items - 1, at + 1); }
    out.left = keys.left; out.right = keys.right;
    out.changed = this.cursors[screen] !== from ? 1 : 0;
    return out;
  }

  // ---------- the look of the models ----------
  setModelJitter(model, jitter) {
    this.modelJitter[model] = jitter;
    for (const o of this.models[model]) this.objectJitter.delete(o);
  }
  setObjectJitter(model, index, jitter) { this.objectJitter.set(this.models[model][index], jitter); }
  setHidden(model, index, hidden) { const o = this.models[model][index]; if (hidden) this.hidden.add(o); else this.hidden.delete(o); }
  // draws one of the movies as the models look now (`speed`: set first)
  drawMovie(r, i, speed) {
    const mv = this.movies[i];
    if (speed !== undefined) mv.setSpeed(speed);
    const model = mv.modelIndex;
    mv.draw(r, null, DT, {
      jitterOf: (k, o) => (this.objectJitter.has(o) ? this.objectJitter.get(o) : this.modelJitter[model]),
      hide: this.hidden,
    });
  }

  // ---------- the menus ----------
  tickMenu(m, keys) {
    const s = this.screen;
    const isMain = s === SCREEN.MAIN;
    const active = isMain ? this.still : this.still && !this.entering && !this.leaving;
    const input = this.readCursor(s, m.items, m.back, keys, active);
    const i = this.cursors[s];
    let result = 0;
    if (input.changed && (input.up || input.down)) {
      this.speak(m.sounds[i], m.volume);
      if (input.up) { this.menuMovie = m.up[i]; this.movies[this.menuMovie].rewind(true); this.speed = -1; }
      else { this.menuMovie = m.down[i]; this.movies[this.menuMovie].rewind(); this.speed = 1; }
    }
    if (input.back) {
      this.menuMovie = m.up[m.back];
      this.movies[this.menuMovie].rewind();
      this.speak(m.sounds[isMain ? m.back : i], m.volume);
      this.speed = 0;
    }
    if (isMain) {
      if (this.leaving) {
        if (++this.waitFrame === F(20)) { this.leaving = false; this.waitFrame = 0; return RESULT.LEAVE; }
      }
      if (input.confirm && !this.leaving) {
        this.voices.play(1, 90);
        if (i < 3) { result = m.results[i]; this.setCamera(0); }
        else { this.leaving = true; this.waitFrame = 0; }
      }
      return result;
    }
    if (this.leaving && this.movies[m.close].finished) {
      this.leaving = false;
      this.setCamera(3);
      return m.results[i];
    }
    if (input.confirm) {
      if (s === SCREEN.OPTION && i < 2) {
        const key = i === 0 ? 'soundEffects' : 'vibration';
        this.options[key] ^= 1;
        this.speak([[132, 131][this.options[key]]], 90);
        this.showOptions();
        this.onOptions && this.onOptions(this.options);
        return 0;
      }
      this.voices.play(1, 90);
      if (i !== m.back) {
        this.setCamera(s === SCREEN.CD ? [0, 0, 3][i] : 0);
        return m.results[i];
      }
      this.menuMovie = m.close;
      this.movies[m.close].rewind();
      this.leaving = true;
      this.speed = 1;
    }
    return 0;
  }

  showOptions() {
    // [replaced, shown for off]: sound effects 2 -> 1, vibration 4 -> 3
    const o = this.models[M.OPTION];
    o[2] = this.options.soundEffects ? this.optionObjects[2] : this.optionObjects[1];
    o[4] = this.options.vibration ? this.optionObjects[4] : this.optionObjects[3];
  }

  tickTrack(keys) {
    const input = this.readCursor(SCREEN.TRACK, 2, 1, keys, this.still, false);
    const onNumber = this.cursors[SCREEN.TRACK] === 0;
    if (onNumber && (input.left || input.right)) {
      if (input.right) { if (++this.track > this.numTracks) this.track = 1; this.menuMovie = 51; this.arrow = 1; }
      else { if (--this.track < 1) this.track = this.numTracks; this.menuMovie = 50; this.arrow = 0; }
      this.onTrack && this.onTrack(this.track);
      this.voiceLine = sayNumber(this.track, 1);
      this.vibriState = 5;
      this.voices.play(this.voiceLine.clips, 64);
      this.movies[this.menuMovie].rewind();
      this.speed = 1;
    }
    if (input.back) { this.vibriState = 5; this.voices.play(96, 90); this.menuMovie = 52; this.movies[52].rewind(); this.speed = 1; }
    if (input.changed && input.up) { this.vibriState = 5; this.menuMovie = 52; this.voices.play(this.voiceLine.clips, 64); this.movies[52].rewind(true); this.speed = -1; }
    if (input.changed && input.down) { this.vibriState = 5; this.voices.play(96, 90); this.menuMovie = 52; this.movies[52].rewind(); this.speed = 1; }
    if (this.leaving && ++this.waitFrame === F(10)) { this.setCamera(5); this.leaving = false; }
    if (input.confirm) {
      this.voices.play(1, 90);
      if (!onNumber) { this.leaving = true; this.waitFrame = 0; return RESULT.TRACK_BACK; }
      return RESULT.TRACK_CHOSEN;
    }
    return 0;
  }

  tickVibri() {
    const s = this.vibriState;
    if (s === 1 || s === 3 || s === 5) {
      this.vibriMovie = s;
      if (!this.voices.playing) { this.vibriState = PAUSED; this.vibriFrame = 0; }
    } else if (s === PAUSED) {
      if (++this.vibriFrame === F(90)) {
        this.vibriState = this.vibriMovie - 1;
        this.vibriFrame = 0;
      }
    }
  }

  // the menus drawn
  draw(r, dt, fadeJitter) {
    const s = this.screen;
    if (s === SCREEN.NONE || s === SCREEN.DONE) return;
    const m = MENUS[s];
    let jitter = MENU_JITTER;
    if (s === SCREEN.MAIN && this.previous === SCREEN.NONE) jitter += fadeJitter;
    if ((s === SCREEN.PSJ || s === SCREEN.CD) && this.next === SCREEN.DONE) jitter += fadeJitter;
    if (s === SCREEN.TRACK && this.fade === 'out' && this.cursors[SCREEN.TRACK] === 0) jitter += fadeJitter;
    if (this.leaving && s === SCREEN.MAIN) jitter = this.waitFrame * 300;

    this.drawVibri(r, jitter);

    // the camera: the screen's own, or the swing between two screens
    const moving = this.fadeFrame > 0;
    let cue = -1;
    if (s === SCREEN.MAIN) {
      if (this.fade === 'out' && this.cursors[s] !== 3) cue = this.cameraCue;
      if (this.fade === 'in' && this.previous !== SCREEN.NONE) cue = this.cameraCue;
    } else if (s === SCREEN.TRACK) cue = this.cameraCue;
    else if (moving) cue = this.cameraCue;
    this.cameras[13].update(r, null, dt);
    this.updateCamera(r, cue);

    if (s === SCREEN.TRACK) { this.drawTrack(r, dt, jitter, fadeJitter); return; }
    const movie = this.entering ? this.movies[m.open] : this.movies[this.menuMovie];
    if (this.entering && this.fade === 'none') this.speed = 1;
    movie.setSpeed(this.speed);
    movie.draw(r, null, dt, { jitter });
    if (this.entering && movie.finished) { this.speed = 0; this.entering = false; this.menuMovie = m.up[this.cursors[s]]; }
  }

  drawVibri(r, jitter) {
    if (this.vibriState === HIDDEN) return;
    // the two "Z"s of Vibri asleep are hidden on the results and the high scores
    const hide = this.screen >= SCREEN.PSJ_HISCORE && this.screen <= SCREEN.AGAIN;
    this.setModelJitter(M.VIBRI, jitter + 4);
    this.setHidden(M.VIBRI, 19, hide);
    this.setHidden(M.VIBRI, 20, hide);
    lookAlongZ(r, -2661, 534, 627);
    const movie = this.vibriState === PAUSED ? this.vibriMovie : this.vibriState;
    this.drawMovie(r, movie, this.vibriState === PAUSED ? 0 : 1);
    if (this.vibriState !== PAUSED) this.vibriMovie = this.vibriState;
  }

  drawTrack(r, dt, jitter, fadeJitter) {
    const movie = this.movies[this.menuMovie];
    movie.setSpeed(this.speed);
    const onNumber = this.cursors[SCREEN.TRACK] === 0;
    const objects = this.models[M.TRACK];
    // the arrow just pressed, and the back item when chosen, shake more
    movie.draw(r, null, dt, { jitter, jitterOf: k => (k === this.arrow && this.menuMovie !== 52) || (k === 2 && !onNumber) ? TEXT_JITTER : jitter, objects });
    let numberJitter = onNumber ? 5 : 0;
    if (this.fade === 'out' && onNumber) numberJitter += fadeJitter;
    this.drawFont(r, String(this.track), numberJitter, this.track >= 10 ? 70 : 170, 0, onNumber ? 2.8 : 1.8);
  }

  // ---------- text ----------
  // the game's vector font, in the current view; '~' gives the next character its
  // second form, '\n' starts a line, and Japanese voicing marks go over the character before
  drawFont(r, text, jitter, x, y, scale) {
    const japanese = this.lang === JAPANESE;
    const width = Math.trunc(90 * scale);
    let column = 0, marks = 0, row = 0, second = false;
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      let glyph = (c - (japanese ? 0x90 : 0x20)) & 0xFF;
      if (japanese) {
        if (c === 0xDE || c === 0xDF) marks++;
        if (c >= 0x30 && c <= 0x3F) glyph = c - 0x30;
        if (ch === '!') glyph = 13;
        if (ch === '&') glyph = 14;
      }
      if (second) { second = false; glyph = (c + 32) & 0xFF; }
      if (ch === '~') second = true;
      else if (ch === ' ') column++;
      else if (ch === '\n') { row++; column = 0; marks = 0; }
      else {
        const index = (japanese ? JAPANESE_OBJECTS : FONT_OBJECTS)[glyph];
        const obj = this.font[index || 0];
        const px = x + width * (column - marks), py = y + row * 230;
        column++;
        if (!obj || index === undefined) continue;
        const local = mul(translation(px, py, 2690), [scale, 0, 0, 0, scale, 0, 0, 0, scale, 0, 0, 0]);
        r.drawObject(obj, local, { jitter: jitter + 4.5 });
      }
    }
  }
  // a line of the results, under the models
  drawText(r, text, jitter) {
    lookAlongFixed(r, 0, 0, 0, 295.625, 3.75);
    this.drawFont(r, text, jitter, -1800, 1050, 1);
  }

  // ---------- numbers and signs ----------
  // `value` in the digits, without leading zeros; with `seconds`, the first shows "sec."
  showNumber(swaps, value, seconds = false) {
    const count = seconds ? 5 : 6;
    const first = seconds ? 1 : 0;
    const digits = [];
    let divisor = 1;
    for (let i = 0; i < count; i++) { digits[count - i - 1] = Math.trunc(value / divisor) % 10; divisor *= 10; }
    let shown = false;
    for (let i = 0; i < count; i++) {
      const index = count - (i + 1) + first;
      if (digits[i] !== 0 || shown) { shown = true; swaps[index].show(digits[i] + 1); }
      else swaps[index].show(0);
    }
    if (!shown) swaps[first].show(1);
    if (seconds) swaps[0].show(11);
  }
  resetSwaps(swaps) { for (const s of swaps) s.show(0); }
  showMarks(score) {
    const marks = toMarks(score);
    for (let i = 0; i < 7; i++) this.marks[6 - i].show(marks[i] + 1);
  }
  pickComment() {
    const n = Math.floor(Math.random() * 10);
    this.pickedComment = n < 4 ? 0 : n < 7 ? 1 : n < 9 ? 2 : 3;
  }
  wait(sixtieths) {
    if (++this.waitFrame === F(sixtieths)) { this.waitFrame = 0; return true; }
    return false;
  }

  // ---------- CLEAR: the course was played to the end ----------
  // On a speed course, the time taken; on the others, the bonus and the score,
  // then either Vibri's comment or, from the score that passes, the medal and
  // the course's score said step by step. Then, if it is a high score, the high scores.
  arriveClear() {
    const R = this.results;
    const score = R.speed ? R.seconds : R.score + R.bonus;
    this.voiceLine = sayNumber(score, R.speed ? 1 : 0);
    for (const c of this.cameras) c.rewind();
    this.resetSwaps(this.scoreDigits); this.resetSwaps(this.bonusDigits); this.resetSwaps(this.totalDigits);
    this.resetSwaps(this.songTotalDigits); this.resetSwaps(this.marks);
    this.pickComment();
    // the sign shows the rank's comment; the movie, voice and text show the one just picked
    this.commentSign.show([1, 0, 2, 3][R.comment]);
    this.frame = 0; this.waitFrame = 0; this.repeat = 0; this.hiscoreFrame = 0; this.leaveFrame = 0;
    this.music.stop();
    this.voices.stop();
    this.vibriState = HIDDEN;
    if (R.speed) {
      this.speedMeterSign.show(R.course - COURSE.SPEED_1);
      this.voices.play([8, 8, 9, 13, 90, 218], 64);
      this.showNumber(this.scoreDigits, R.seconds, true);
    } else {
      this.voices.play([13, 14, 225, 226, 227, 192], 64);
      this.showNumber(this.scoreDigits, R.score);
      this.showMarks(R.score);
      const medals = MEDAL_SCORES[R.course] || MEDAL_SCORES[3];
      this.passScore = medals[0];
      if (score >= medals[2]) this.medal = 2;
      else if (score >= medals[1]) this.medal = 1;
      else if (score >= this.passScore) this.medal = 0;
    }
    this.showNumber(this.bonusDigits, R.bonus);
    this.showNumber(this.totalDigits, score);
    this.showNumber(this.songTotalDigits, score);
    this.entering = false; this.leaving = false; this.menuMovie = 0; this.medalShown = false;
  }

  // a button: on to the high scores, or away
  readResultsButton(keys) {
    if ((keys.confirm || keys.back) && this.fade === 'none' && !this.hiscoreFrame && !this.leaveFrame) {
      this.music.stop();
      this.voices.play(1, 90);
      if (this.results.rank === 0) return RESULT.RESULTS_DONE;
      this.leaveFrame = 1;
    }
    if (this.leaveFrame) {
      this.leaveFrame++;
      if (this.leaveFrame === F(20)) { this.hiscoreFrame = 1; this.leaveFrame = 0; }
    }
    return 0;
  }

  drawClear(r, jitter, keys) {
    const R = this.results, lang = this.lang;
    const score = R.speed ? R.seconds : R.score + R.bonus;
    const leaveJitter = this.leaveFrame * 300;
    let modelJitter = MENU_JITTER + leaveJitter;
    if (this.fade === 'out') { modelJitter += jitter; this.music.stop(); }
    for (const m of [M.CLEAR_OVER, M.VIBRI, M.CLEAR_SONG]) this.setModelJitter(m, modelJitter);
    const button = this.readResultsButton(keys);
    if (button) return button;
    const text = t => this.drawText(r, t, leaveJitter + jitter);
    const view = () => lookAlongFixed(r, 0, 0, -187.5, 0, 2.5);
    if (this.hiscoreFrame) { this.music.stop(); return this.drawHiscore(r, jitter, false, this.hiscoreFrame++, keys); }
    view();
    const f = this.frame;
    if (R.speed) {
      // the time taken to reach the target speed
      this.setModelJitter(M.SPEED_METER, modelJitter);
      if (F(270) < f && lang !== JAPANESE) {
        text(this.texts.speed[lang][0].replace('%d', R.seconds));
        text(this.texts.speed[lang][1]);
      }
      view();
      this.drawMovie(r, 95);
      if (f >= F(85)) { this.drawMovie(r, 97); this.drawMovie(r, 73); }
      if (f <= F(84)) { this.drawMovie(r, 32); this.drawMovie(r, 96); }
      else if (f <= F(270)) this.drawMovie(r, 33);
      else if (f <= F(360)) {
        this.drawMovie(r, 34);
        if (lang === JAPANESE) text(this.texts.speed[JAPANESE][0]);
      }
      if (f === F(366)) this.music.play(this.voiceLine.clips, 64);
      if (!this.menuMovie && F(372) < f && !this.music.playing) { this.music.play([206, 220], 64); this.menuMovie++; }
      if (f >= F(361)) {
        const mv = SPEED_MOVIES[this.menuMovie];
        this.drawMovie(r, mv);
        if (lang === JAPANESE) {
          if (this.menuMovie <= 1) text(this.texts.speed[JAPANESE][1].replace('%d', R.seconds));
          if (this.menuMovie === 2) text(this.texts.speed[JAPANESE][2]);
        }
        if (this.movies[mv].finished) {
          if (this.menuMovie === 3) {
            if (R.rank !== 0) { if (!this.leaveFrame) this.leaveFrame = 1; return 0; }
            return RESULT.RESULTS_DONE;
          }
          this.menuMovie++;
        }
      }
    } else {
      if (f === F(360)) this.music.play(this.voiceLine.clips, 64);
      if (f < F(112)) this.drawMovie(r, 67);
      else if (!this.medalShown) this.drawMovie(r, 101);
      if (f < F(360)) {
        // the bonus
        this.drawMovie(r, 100);
        if (f >= F(320)) text(this.texts.bonus[lang][1]);
        else if (f >= F(190)) text(this.texts.bonus[lang][0]);
      } else if (!this.leaving && !this.medalShown) {
        // the score counted, then whether it passes
        view();
        if (!this.entering && F(362) < f && !this.music.playing) { this.entering = true; this.music.play([193, 207, 194], 64); }
        if (this.entering) {
          this.drawMovie(r, 7);
          if (this.movies[7].finished && this.wait(40)) {
            if (score < this.passScore) { this.leaving = true; this.voices.play(CLEAR_COMMENT_SOUNDS[this.pickedComment], 64); }
            else { this.medalShown = true; this.voices.play(MEDAL_SOUNDS[this.medal], 64); }
            this.entering = false;
          }
        } else this.drawMovie(r, 6);
        text(this.texts.bonus[lang][2].replace('%d', R.score + R.bonus));
      } else if (this.leaving) {
        // the score did not pass: Vibri's comment
        view();
        const mv = [8, 9, 11, 10][this.pickedComment];
        this.drawMovie(r, mv);
        text(this.texts.clearComments[lang][this.pickedComment]);
        if (this.movies[mv].finished && this.wait(30)) {
          if (R.rank !== 0) this.leaveFrame = 1;
          else return RESULT.RESULTS_DONE;
        }
      } else {
        // the medal, and the score said
        if (F(30) < this.waitFrame) {
          this.waitFrame = 0;
          if (R.rank === 0) return RESULT.RESULTS_DONE;
          this.leaveFrame = 1;
        }
        const step = MEDAL_STEPS[this.medal][this.menuMovie];
        const movie = STEP_MOVIES[step], movie2 = STEP_MOVIES2[step], camera = STEP_CAMERAS[step];
        const stepText = this.texts.steps[lang][step];
        if (camera >= 0) this.cameras[camera].update(r, null, DT);
        if (movie >= 0) this.drawMovie(r, movie);
        if (movie2 > 0) this.drawMovie(r, movie2);
        if (movie === 26) text(stepText.replace('%s', this.texts.courseNames[lang][R.course] || ''));
        else if (movie === 27 || movie === 28) text(stepText.replace('%d', score));
        else if (stepText) text(stepText);
        if (movie >= 0 && this.movies[movie].finished) {
          if (movie === 26) {
            this.voices.play(this.voiceLine.timeline, 64);
            this.music.play(SCORE_SOUNDS[this.voiceLine.tempo], 64);
          }
          if (movie === 27 && this.repeat < this.voiceLine.tempo - 1) {
            // the score is counted again while it is said
            this.movies[27].rewind();
            this.repeat++;
          } else if (movie === 26) {
            if (this.voiceLine.tempo !== 0) { this.menuMovie++; this.movies[26].rewind(); }
            else this.menuMovie += 2;
          } else if (movie === 28) {
            // the high score's step only when there is one
            this.menuMovie += R.rank !== 0 ? 1 : 2;
          } else {
            const next = this.menuMovie + 1;
            const nextMovie = STEP_MOVIES[MEDAL_STEPS[this.medal][next]];
            if (nextMovie !== -1 && nextMovie !== undefined) { this.menuMovie = next; this.movies[nextMovie].rewind(); }
            else this.waitFrame++;
          }
          const newMovie = STEP_MOVIES[MEDAL_STEPS[this.medal][this.menuMovie]];
          if (newMovie === 26) this.voices.play(COURSE_NAME_SOUNDS[R.course] || COURSE_NAME_SOUNDS[3], 64);
          else if (newMovie === 31 && !this.waitFrame) this.voices.play(59, 90);
          else if (newMovie === 30) this.voices.play([57, 58], 64);
          else if (newMovie === 29) this.voices.play(56, 90);
        }
      }
    }
    this.frame++;
    return 0;
  }

  // ---------- AGAIN: the course was lost ----------
  // Vibri's comment, said and shown, and the score (when a speed course's time
  // ran out, "time up" instead); then, if it is a high score, the high scores.
  arriveAgain() {
    const R = this.results;
    this.resetSwaps(this.scoreDigits); this.resetSwaps(this.marks);
    this.pickComment();
    this.hiscoreFrame = 0; this.leaveFrame = 0; this.frame = 0; this.waitFrame = 0;
    this.music.stop();
    this.vibriState = HIDDEN;
    if (!R.speed || !R.timeUp) {
      this.voices.play(AGAIN_COMMENT_SOUNDS[this.pickedComment], 64);
      this.showNumber(this.scoreDigits, R.score);
      this.showMarks(R.score);
    } else this.voices.play([9, 12, 176, 182], 64);
  }

  drawAgain(r, jitter, keys) {
    const R = this.results, lang = this.lang;
    const leaveJitter = this.leaveFrame * 300;
    let modelJitter = MENU_JITTER + leaveJitter;
    if (this.fade === 'out') modelJitter += jitter;
    for (const m of [M.CLEAR_OVER, M.VIBRI]) this.setModelJitter(m, modelJitter);
    if ((keys.confirm || keys.back) && this.fade === 'none' && !this.hiscoreFrame && !this.leaveFrame) {
      this.voices.play(1, 90);
      if (R.rank === 0) return RESULT.RESULTS_DONE;
      this.leaveFrame = 1;
    }
    if (this.leaveFrame) {
      this.leaveFrame++;
      if (this.leaveFrame === F(20)) { this.hiscoreFrame = 1; this.leaveFrame = 0; }
    }
    if (this.hiscoreFrame) { this.music.stop(); return this.drawHiscore(r, jitter, false, this.hiscoreFrame++, keys); }
    const text = t => this.drawText(r, t, leaveJitter + jitter);
    const view = () => lookAlongFixed(r, 0, 0, -187.5, 0, 2.5);
    const f = this.frame;
    if (R.speed && R.timeUp) {
      // time is up: the scribble, then Vibri, shaking less and less, and "game over", then "time up"
      if (f >= F(193) && f <= F(258)) this.setModelJitter(M.VIBRI, (F(258) - f) * 10);
      else this.setModelJitter(M.VIBRI, modelJitter);
      this.setModelJitter(M.SPEED_SCRIBBLE, modelJitter + 30);
      view();
      if (f <= F(192)) this.drawMovie(r, 98);
      else if (f <= F(258)) {
        this.drawMovie(r, 99); this.drawMovie(r, 20); this.drawMovie(r, 72);
        text(this.texts.end[lang][0]);
      } else {
        this.drawMovie(r, 72); this.drawMovie(r, 21);
        text(this.texts.end[lang][1]);
      }
      if (this.frame++ === F(390)) {
        if (R.rank === 0) return RESULT.RESULTS_DONE;
        this.leaveFrame = 1;
      }
      return 0;
    }
    view();
    if (!R.speed) {
      if (f < F(100)) this.drawMovie(r, 68);
      else if (f < F(112)) this.drawMovie(r, 69);
      else this.drawMovie(r, 70);
    }
    if (f >= F(140)) this.drawMovie(r, 71);
    if (f < F(144)) this.drawMovie(r, 19);
    else {
      const c = this.pickedComment;
      if (c === 0) {
        this.drawMovie(r, f < F(212) ? 12 : 13);
        if (f >= F(188)) this.drawMovie(r, 14);
      } else if (c === 1) this.drawMovie(r, f < F(200) ? 16 : 17);
      else this.drawMovie(r, [12, 16, 18, 15][c]);
      if (F(200) < f) {
        if (c === 2) text(this.texts.failComments[lang][f < F(360) ? 2 : 4]);
        else text(this.texts.failComments[lang][c]);
      }
    }
    this.frame++;
    if (this.frame === F(480)) {
      if (R.rank !== 0) { this.leaveFrame = 1; return 0; }
      return RESULT.RESULTS_DONE;
    }
    return 0;
  }

  // ---------- AGAIN SELECT: try again, or back ----------
  arriveAgainSelect() {
    const c = this.results.course;
    this.againCourseSign.show([0, 1, 2, 3, 4, 6, 6, 6, 5][c] || 0);
    this.againSpeedSign.show([0, 0, 0, 0, 0, 1, 2, 3, 0][c] || 0);
    this.menuMovie = 59;
    this.cursors[SCREEN.AGAIN_SELECT] = 0;
    this.speed = 0;
    this.vibriState = SITTING;
    this.leaving = false;
    this.cameraCue = 1;
    this.setCamera(1);
  }

  drawAgainSelect(r, jitter, keys) {
    const input = this.readCursor(SCREEN.AGAIN_SELECT, 2, 1, keys, this.still);
    const i = this.cursors[SCREEN.AGAIN_SELECT];
    let modelJitter = MENU_JITTER;
    if (input.up) { this.menuMovie = [59, 60][i]; this.movies[this.menuMovie].rewind(true); this.speed = -1; }
    else if (input.down) { this.menuMovie = [60, 59][i]; this.movies[this.menuMovie].rewind(); this.speed = 1; }
    if (input.up || input.down) { this.vibriState = 3; this.voices.play([99, 100][i], 90); }
    if (input.back) {
      this.menuMovie = 60;
      this.vibriState = 3;
      this.movies[60].rewind();
      this.voices.play([99, 100][i], 90);
      this.speed = 0;
    }
    if (this.next === SCREEN.DONE) modelJitter += jitter;
    this.setModelJitter(M.AGAIN, modelJitter);
    this.drawVibri(r, modelJitter);
    if (!this.still && this.next !== SCREEN.DONE) this.updateCamera(r, this.cameraCue);
    else this.cameras[13].update(r, null, DT);
    this.drawMovie(r, this.menuMovie, this.speed);
    if (this.leaving && this.movies[61].finished) {
      this.leaving = false;
      this.cameraCue = 3;
      this.setCamera(3);
      return RESULT.AGAIN_BACK;
    }
    if (input.confirm) {
      this.voices.play(1, 90);
      if (i !== 1) return RESULT.AGAIN;
      this.menuMovie = 61;
      this.leaving = true;
      this.speed = 1;
    }
    return 0;
  }

  // ---------- the high scores ----------
  arriveHiscore(frame) {
    const m = M.HISCORE;
    this.cursors.back = 0;
    this.menuMovie = 64;
    this.frame = 0;
    this.speed = 0;
    if (this.screen === SCREEN.PSJ_HISCORE) this.music.play(32, 90);
    for (const mv of this.movies) mv.rewind();
    this.entering = true; this.leaving = false;
    this.vibriState = LYING;
    if (frame === 0) {
      this.courseSign.show(this.hiscoreCourse);
      this.speedSign.show(0);
      for (const i of [0, 1, 2, 7, 27, 48, 49]) this.setHidden(m, i, false);
    } else {
      // after a course: no menu
      const c = this.results.course;
      this.courseSign.show([0, 1, 2, 3, 4, 5, 5, 5][c] || 0);
      this.speedSign.show([0, 0, 0, 0, 0, 1, 2, 3][c] || 0);
      for (const i of [0, 1, 2, 7]) this.setHidden(m, i, true);
    }
  }
  showHighScores(course) {
    const seconds = course >= COURSE.SPEED_1 && course < COURSE.IN_ORDER;
    const hs = this.highScores;
    this.showNumber(this.firstScoreDigits, hs[course * 3] || 0, seconds);
    this.showNumber(this.secondScoreDigits, hs[course * 3 + 1] || 0, seconds);
    this.showNumber(this.thirdScoreDigits, hs[course * 3 + 2] || 0, seconds);
  }

  // With `frame` 0, PSJ HISCORE: the high scores of the course chosen with left
  // and right; otherwise frame `frame` of the high scores shown after a course,
  // the new score's rank blinking.
  drawHiscore(r, jitter, still, frame, keys) {
    const m = M.HISCORE;
    const RANKS = [27, 48, 49];
    if (frame === 2) this.arriveHiscore(frame);
    const course = this.screen === SCREEN.PSJ_HISCORE ? this.hiscoreCourse : this.results.course;
    this.showHighScores(course);
    const input = this.readCursor('back', 2, 1, keys, still, false);
    lookAlongZ(r, -2661, 534, 627);
    if (frame !== 0) {
      this.setModelJitter(m, MENU_JITTER);
      for (const i of RANKS) this.setHidden(m, i, false);
      // the new score's rank blinks
      const rank = this.results.rank;
      if (rank) this.setHidden(m, RANKS[rank - 1], frame % FPS < F(30));
      this.drawVibri(r, MENU_JITTER);
      lookAlongZ(r, -2661, 534, 627);
      if (this.fade === 'none' && F(20) < frame) {
        this.movies[66].setSpeed(0); this.movies[66].seek(0);
        this.drawMovie(r, 66);
        this.drawMovie(r, 63);
      } else this.drawMovie(r, 62, this.fade === 'out' ? -1 : 1);
      if (frame === F(180)) { this.movies[62].rewind(true); return RESULT.RESULTS_DONE; }
      return 0;
    }
    const SOUNDS = [114, 113, 112, 96];
    const atCourse = this.cursors.back === 0;
    if (input.back) { this.vibriState = 1; this.voices.play(SOUNDS[3], 90); }
    if (atCourse && (input.left || input.right)) {
      if (input.left) { this.menuMovie = 64; if (--this.hiscoreCourse < 0) this.hiscoreCourse = 2; }
      else { this.menuMovie = 65; if (++this.hiscoreCourse >= 3) this.hiscoreCourse = 0; }
      this.voices.play(SOUNDS[this.hiscoreCourse], 90);
      this.vibriState = 1;
      this.movies[this.menuMovie].rewind();
      this.speed = 1;
      this.courseSign.show(this.hiscoreCourse);
    }
    if (input.changed && (input.down || input.up)) {
      this.vibriState = 1;
      this.voices.play(this.cursors.back !== 0 ? SOUNDS[3] : SOUNDS[this.hiscoreCourse], 90);
    }
    return this.drawHiscoreMenu(r, input, [6]);
  }

  // the menu of the high scores: the cursor movie, the course's name (or back) shaking more
  // (`names`: where the course's name shows in the model)
  drawHiscoreMenu(r, input, names) {
    const m = M.HISCORE;
    this.movies[66].setSpeed(0);
    this.movies[66].seek(this.cursors.back + 0.5);
    this.drawVibri(r, MENU_JITTER);
    lookAlongZ(r, -2661, 534, 627);
    this.setModelJitter(m, MENU_JITTER);
    if (this.cursors.back === 0) for (const i of names) this.setObjectJitter(m, i, TEXT_JITTER);
    else this.setObjectJitter(m, 7, TEXT_JITTER);
    if (this.fade === 'none') {
      if (this.cursors.back !== 0) this.drawMovie(r, 66);
      else this.drawMovie(r, this.menuMovie, this.speed);
      this.drawMovie(r, 63);
    } else this.drawMovie(r, 62, this.fade === 'in' ? 1 : -1);
    if (input.confirm && this.cursors.back !== 0) {
      this.voices.play(1, 90);
      this.movies[62].rewind(true);
      return RESULT.HISCORE_BACK;
    }
    return 0;
  }

  // UNKNOWN HISCORE: the high scores of the courses on the player's own CD
  arriveUnknownHiscore() {
    for (const i of [0, 1, 2, 7, 27, 48, 49]) this.setHidden(M.HISCORE, i, false);
    this.cursors.back = 0;
    this.menuMovie = 64;
    this.speed = 0;
    this.music.play(32, 90);
    this.entering = true;
    this.vibriState = LYING;
    this.courseSign.show([3, 4, 5, 5, 5][this.unknownCourse]);
    this.speedSign.show([0, 0, 1, 2, 3][this.unknownCourse]);
    this.voices.stop();
  }

  drawUnknownHiscore(r, jitter, keys) {
    const SOUNDS = [[115, 120], [117, 120], [116, 114], [116, 113], [116, 112], [96]];
    const COURSES = [COURSE.ONE_TRACK, COURSE.ALL_TRACKS, COURSE.SPEED_1, COURSE.SPEED_2, COURSE.SPEED_3];
    this.showHighScores(COURSES[this.unknownCourse]);
    const input = this.readCursor('back', 2, 1, keys, this.still, false);
    if (input.back) { this.vibriState = 1; this.voices.play(SOUNDS[5], 64); }
    if (this.cursors.back === 0 && (input.left || input.right)) {
      if (input.left) { this.menuMovie = 64; if (--this.unknownCourse < 0) this.unknownCourse = 4; }
      else { this.menuMovie = 65; if (++this.unknownCourse >= 5) this.unknownCourse = 0; }
      this.voices.play(SOUNDS[this.unknownCourse], 64);
      this.vibriState = 1;
      this.movies[this.menuMovie].rewind();
      this.speed = 1;
      this.courseSign.show([3, 4, 5, 5, 5][this.unknownCourse]);
      this.speedSign.show([0, 0, 1, 2, 3][this.unknownCourse]);
    }
    if (input.changed && (input.down || input.up)) {
      this.vibriState = 1;
      this.voices.play(this.cursors.back !== 0 ? SOUNDS[5] : SOUNDS[this.unknownCourse], 64);
    }
    // the speed courses' names have "Speed" too
    return this.drawHiscoreMenu(r, input, this.unknownCourse >= 2 ? [5, 6] : [6]);
  }
}

function blankKeys() { return { up: 0, down: 0, left: 0, right: 0, confirm: 0, back: 0 }; }

// ---------- what the results say ----------
const MEDAL_SCORES = [[2000, 4000, 6000], [2000, 4000, 6000], [1500, 3500, 5500], [2500, 4500, 6500], [20000, 35000, 50000]];
const STEP_CAMERAS = [3, 4, 5, 6, 7, 11, 12, 8, 9, 10, -1];
const STEP_MOVIES = [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, -1];
const STEP_MOVIES2 = [93, 93, 93, 93, 94, 94, 94, -1, 93, 93, -1];
const MEDAL_STEPS = [[0, 4, 5, 6, 7, 9, 10, 0, 0, 0, 0], [0, 1, 4, 5, 6, 7, 8, 9, 10, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
const MEDAL_SOUNDS = [[48, 48], [48, 48, 51, 52], [48, 48, 49, 50, 48, 48, 51, 52]];
const COURSE_NAME_SOUNDS = [[36, 53, 54], [35, 53, 54], [34, 53, 54], [38, 39, 54], [37, 39, 54]];
const SCORE_SOUNDS = [[62, 60, 61], [62, 63, 62, 60, 61], [62, 63, 62, 63, 62, 60, 61]];
const CLEAR_COMMENT_SOUNDS = [[196], [197, 198, 199], [200, 201, 202, 203, 204], [208, 209, 210, 211, 212, 213, 214, 215, 216, 217]];
const SPEED_MOVIES = [35, 36, 37, 38];
const AGAIN_COMMENT_SOUNDS = [
  [12, 176, 177, 179, 180, 181, 180, 181], [12, 176, 177, 184],
  [12, 176, 177, 185, 186, 187, 188, 189, 190, 190, 190, 190, 191], [12, 176, 177, 183],
];

// ---------- the voice saying a number (in Japanese), up to 999999 ----------
// clips: the sounds said; timeline: beat by beat, rests first; tempo: 6, 14 or 22 beats
const SYLLABLES = [[64, 1], [65, 1], [66, 1], [67, 2], [68, 2], [69, 2], [70, 1], [71, 1], [72, 1], [73, 2], [74, 1], [75, 1], [76, 2], [77, 1], [78, 1], [79, 1]];
const SILENCE = [0, 0];
const S = i => SYLLABLES[i];
// the digits in each form they are said in: plain, 1, before "ten thousand", before "hundred"
const SPOKEN = [
  [SILENCE], [S(0), S(13)], [SILENCE, S(2)], [SILENCE, S(3)], [SILENCE, S(5)], [SILENCE, S(6)], [S(7), S(8)], [SILENCE, S(9)], [S(10), S(15)], [SILENCE, S(12)],
  [SILENCE], [S(0), S(1)], [SILENCE, S(2)], [SILENCE, S(3)], [SILENCE, S(5)], [SILENCE, S(6)], [S(7), S(8)], [SILENCE, S(9)], [S(10), S(11)], [SILENCE, S(12)],
  [SILENCE], [S(0), S(1)], [SILENCE, S(2)], [SILENCE, S(4)], [SILENCE, S(5)], [SILENCE, S(6)], [S(7), S(8)], [SILENCE, S(9)], [S(10), S(11)], [SILENCE, S(12)],
  [SILENCE], [SILENCE, SILENCE], [SILENCE, S(2)], [SILENCE, S(3)], [SILENCE, S(5)], [SILENCE, S(6)], [S(7), S(14)], [SILENCE, S(9)], [S(10), S(15)], [SILENCE, S(12)],
];
const TENS = [0, 81, 80, 80, 80, 81, 81, 80, 81, 80, 89];
const HUNDREDS = [0, 82, 82, 83, 84, 85, 85, 84, 85, 84];
const FORM_MAN = 2, FORM_HUNDREDS = 3, REST = 91;

export function sayNumber(number, form) {
  const clips = [];
  let beats = 0;
  const unit = (sound) => { clips.push(sound); beats += 2; };
  const digit = (d, f) => {
    if (d === 0) return;
    for (const [sound, b] of SPOKEN[f * 10 + d]) if (sound) { clips.push(sound); beats += b; }
  };
  const tens = (n, f) => {
    const t = Math.trunc(n / 10), u = n - t * 10;
    if (t > 0) {
      if (t >= 2) digit(t, f !== FORM_MAN ? f : 0);
      if (u === 0 && f === 0) { clips.push(TENS[10]); clips.push(REST); beats += 2; }
      else unit(TENS[t]);
    }
    digit(u, f);
  };
  const thousands = (n, f) => {
    const high = Math.trunc(n / 100), rest = n - high * 100;
    const th = Math.trunc(high / 10), h = high - th * 10;
    if (th >= 2) digit(th, f);
    if (th > 0) unit(th === 3 ? 87 : 86);
    if (h >= 2) digit(h, FORM_HUNDREDS);
    if (h > 0) unit(HUNDREDS[h]);
    tens(rest, f);
  };
  if (number <= 0) return { clips: [], timeline: [], tempo: 0 };
  const man = Math.trunc(number / 10000), rest = number - man * 10000;
  tens(man, FORM_MAN);
  if (man > 0) unit(88);
  thousands(rest, form);
  const [tempo, length] = beats >= 15 ? [2, 22] : beats >= 7 ? [1, 14] : [0, 6];
  const timeline = [];
  const rests = length - beats;
  for (let i = 0; i < length; i++) {
    if (i < rests) timeline.push(REST);
    else if (i - rests < clips.length) timeline.push(clips[i - rests]);
    else break;
  }
  return { clips, timeline, tempo };
}

// ---------- the font's objects ----------
// the other characters, from ' ' on (their second forms from 0x80 on)
const FONT_OBJECTS = [
  0, 63, 0, 0, 0, 0, 64, 67, 69, 70, 0, 0, 66, 68, 65, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 0, 0, 62,
  0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 0, 0, 0, 0, 0,
  0, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
  51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 0, 0, 0, 0, 0,
  0, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
  86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 0, 0, 0, 0, 0,
  0, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111,
  102, 0, 0, 0,
];
// the Japanese characters, from 0x90 on
const JAPANESE_OBJECTS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 10, 11, 12,
  0, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  13, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59,
  60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
];
export function glyph(ch) { const c = ch.charCodeAt(0) - 32; return c >= 0 && c < FONT_OBJECTS.length ? FONT_OBJECTS[c] : 0; }
