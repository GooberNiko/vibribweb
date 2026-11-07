// A course: the obstacles coming down the ribbon, Vibri's moves, the score,
// her forms, and the scene drawn around it all.
import { RATE, DELAY } from './analysis.js';
import { ModelMovie, CameraMovie, lookAlongZ } from './movie.js';
import { freeCameraAt } from './level.js';
import { GameCamera } from './camera.js';
import { identity, mul, rotZYX, translation } from './render.js';

export const BLOCK = 0, PIT = 1, LOOP = 2, WAVE = 3;
// buttons: one bit a road
export const B_BLOCK = 1, B_PIT = 2, B_LOOP = 4, B_WAVE = 8;
const ROAD_BUTTONS = [1, 2, 4, 8, 1 | 2, 1 | 4, 1 | 8, 2 | 4, 2 | 8, 4 | 8];
const isDouble = r => r >= 4 && r < 10;
const firstOfTwo = r => r >= 9 ? LOOP : r >= 7 ? PIT : BLOCK;
const secondOfTwo = r => r >= 9 ? r - 6 : r >= 7 ? r - 5 : r - 3;
const firstRoad = r => r < 4 ? r : firstOfTwo(r);
const secondRoad = r => r < 4 ? r : secondOfTwo(r);

const WINDOW = 0.2;        // how far before or past Vibri a part can be pressed for
const MOVE_DONE = 0.5;     // how far into a move Vibri takes the next buttons
const DISTANCE = 10;       // how far ahead the road is seen
const VIBRI = 1.25;        // Vibri's place on the road
const BEATS = 2;           // beats a second

export const COURSES = {
  bronze: { home: true, tracks: [1, 2], highScores: [6000, 4000, 2000] },
  silver: { home: true, tracks: [3, 4], highScores: [6000, 4000, 2000] },
  gold: { home: true, tracks: [5, 6], highScores: [5500, 3500, 1500] },
  one: { home: false, highScores: [6500, 4500, 2500] },
  all: { home: false, highScores: [50000, 35000, 20000] },
  speed1: { home: false, speed: [1.5, 3.5, 210], highScores: [50, 60, 70], label: 0 },
  speed2: { home: false, speed: [1.5, 5.0, 300], highScores: [55, 65, 75], label: 1 },
  speed3: { home: false, speed: [1.5, 6.2, 372], highScores: [65, 75, 85], label: 2 },
  order: { home: false, auto: true, highScores: [0, 0, 0] },
  level: { home: false, highScores: [0, 0, 0] },
};
const METER_MIN = 1.5, METER_MAX = 6.2;

const MOVE_FILES = [
  [['N01_J', 'N01_J_F'], ['N01_J', 'N01_J_F'], ['N01_J', 'N01_J_F'], ['N01_J', 'N01_J_F']],
  [['N02_H'], ['N02_H'], ['N02_H'], ['N02_H', 'N02_H_F']],
  [['N03_L', 'N03_L_F'], ['N03_L', 'N03_L_F'], ['N03_L', 'N03_L_F'], ['N03_L', 'N03_L_F']],
  [['N04_W'], ['N04_W'], ['N04_W', 'N04_W_F'], ['N04_W', 'N04_W_F']],
  [['N05_JH']], [['N06_JL']], [['N07_JW']], [['N08_HL']], [['N09_HW']], [['N10_LW']],
  [['N00_SKIP']],
];
const MOVE_NONE = 10;
const CHARACTERS = ['SUPER', 'PEELOO', 'FROG', 'SNAKE'];
const EVO_ENDS = [58, 23, 19, 0];
const RANK_BONUS = [30, 20, 15, 0];

// ---------- score ----------
class Score {
  constructor(points = 0) { this.reset(points); }
  reset(points) { this.points = points; this.numPresses = 0; this.pressBonus = 0; this.chain = 0; this.presses = []; this.lastBase = 0; this.lastBonus = 0; }
  hit(road, times) {
    const base = isDouble(road) ? 3 : 1;
    const bonus = this.numPresses ? this.pressBonus : 0;
    this.points += (base + bonus + this.chain) * times;
    this.lastBase = base; this.lastBonus = bonus;
    this.chain = Math.min(this.chain + 1, 10);
    this.numPresses = 0;
  }
  // `road` pressed while the part of `partRoad` is coming: 0 none, 1 same, 2 other, 4 other than a double
  press(road, partRoad) {
    let result = 0;
    if (this.numPresses < 2) {
      if (this.numPresses === 0) this.pressBonus = 0;
      const two = isDouble(partRoad);
      const again = this.presses.slice(0, this.numPresses).includes(road);
      const match = two ? (road === firstOfTwo(partRoad) || road === secondOfTwo(partRoad)) : road === partRoad;
      result = again || match ? 1 : two ? 4 : 2;
      this.pressBonus += result;
      this.presses[this.numPresses++] = road;
    }
    return result;
  }
}

// score marks: the score is the rank of a row of 7 non-increasing shapes
const ROWS = [8, 7, 6, 5, 4, 3, 2].map(k => {
  const row = [];
  for (let n = 0; n < 16; n++) { let c = 1; for (let i = 1; i <= n; i++) c = c * (k - 1 + i) / i; row.push(Math.round(c)); }
  return row;
});
export const MAX_SCORE = 116279;
export function toMarks(score) {
  const marks = [];
  for (let i = 0; i < 7; i++) {
    let shape = 0;
    while (shape < 16 && score >= ROWS[i][shape]) shape++;
    if (shape) score -= ROWS[i][shape - 1];
    marks.push(shape);
  }
  return marks;
}

// ---------- the course ----------
export class Gameplay {
  constructor(assets, sfx) {
    this.assets = assets;
    this.sfx = sfx;
    this.road = assets.tmd('ROAD/ROAD.TMD');
    this.point = assets.tmd('ROAD/POINT.TMD')[0];
    this.models = CHARACTERS.map(c => assets.tmd(`CHARA/${c}/MODEL.TMD`));
    this.moves = CHARACTERS.map((c, ci) => MOVE_FILES.map((m, mi) => {
      const files = m[ci] || m[0];
      const a = new ModelMovie(this.models[ci], assets.anm(`CHARA/${c}/${files[0]}.ANM`), mi === MOVE_NONE);
      const b = files[1] ? new ModelMovie(this.models[ci], assets.anm(`CHARA/${c}/${files[1]}.ANM`), false) : a;
      return [a, b];
    }));
    this.evoModel = assets.tmd('METERS/EVO.TMD');
    this.evo = new ModelMovie(this.evoModel, assets.anm('METERS/EVO.ANM'));
    this.camera = new GameCamera(assets);
    this.marks = assets.tmd('FONT/MARK.TMD');
    this.scoreMovie = new ModelMovie(this.marks, assets.anm('METERS/SCORE.ANM'), true);
    this.timeModel = assets.tmd('METERS/TIME.TMD');
    this.timeMovie = new ModelMovie(this.timeModel, assets.anm('METERS/TIME.ANM'));
    this.timeCam = new CameraMovie(assets.anc('METERS/TIME.ANC'));
    this.roundModel = assets.tmd('MESSAGE/ROUND.TMD');
    this.roundMovies = [new ModelMovie(this.roundModel, assets.anm('MESSAGE/ROUND01.ANM')), new ModelMovie(this.roundModel, assets.anm('MESSAGE/ROUND02.ANM'))];
    this.roundCam = new CameraMovie(assets.anc('MESSAGE/ROUND.ANC'));
    this.autoModel = assets.tmd('MESSAGE/AUTO.TMD');
    this.autoMovie = new ModelMovie(this.autoModel, assets.anm('MESSAGE/FB_AUTO.ANM'), true);
    this.autoCam = new CameraMovie(assets.anc('MESSAGE/AUTO.ANC'));
    this.speedModel = assets.tmd('METERS/SPEED.TMD');
    this.speedCam = new CameraMovie(assets.anc('METERS/SPEED_01.ANC'));
    this.dial = new ModelMovie(this.speedModel, assets.anm('METERS/SPEED.ANM'));
    this.target = new ModelMovie(this.speedModel, assets.anm('METERS/SPD_TRGT.ANM'));
    this.needle = new ModelMovie(this.speedModel, assets.anm('METERS/SPD_NEDL.ANM'));
    this.labelModel = assets.tmd('METERS/SPD_LBL.TMD');
    this.labels = [1, 2, 3].map(i => new ModelMovie(this.labelModel, assets.anm(`METERS/SPD_LBL${i}.ANM`)));
  }

  // `analyser`: the track's TrackAnalyser (null: no obstacles); `index`: of the track in the course (round sign)
  // `level`: a level of the editor's (its events come through `analyser`)
  start({ course, analyser, seconds, endTime, score = 0, index = 0, auto = false, level = null }) {
    const info = COURSES[course];
    this.levelMode = !!level;
    this.freeKeys = level ? level.keys : null;
    this.course = course;
    this.home = info.home;
    this.analyser = analyser;
    this.pending = [];
    this.courseSeconds = seconds;
    this.endTime = endTime;
    this.parts = [];
    this.score = new Score(score);
    this.level = 3; this.combo = 0; this.misses = 0;
    this.beatTime = -1e9; this.beatPeriod = 1 / BEATS;
    this.newPart = false; this.lastPartTime = null;
    this.gameOver = false; this.result = null;
    this.speed = BEATS;
    this.quietAt = null;
    this.effect = null;
    this.cameraBreak = false;
    this.auto = auto || !!info.auto;
    this.speedCourse = !!info.speed;
    this.timeUp = false; this.clearSeconds = 0;
    if (this.speedCourse) {
      const [min, max, points] = info.speed;
      this.range = { min, max, points, scored: 0, speed: min };
      this.speed = min;
      this.labels[info.label].rewind();
    }
    this.roundIndex = index;
    this.roundMovies[index % 2].rewind();
    this.roundCam.rewind();
    this.camera.reset(this.home, this.speedCourse);
    this.character = 1; this.lastCharacter = -1;
    this.move = MOVE_NONE; this.alternate = 0;
    this.currentMove().rewind();
    this.evoFrame = 0; this.evo.rewind(); this.evo.setSpeed(0); this.evoJitter = 10;
    this.scoreFrame = 0;
    this.sfx.play(0, 11, 4, 63 / 127);
  }

  currentMove() { return this.moves[this.character][this.move][this.alternate]; }
  setMove(move, alternate) { this.alternate = alternate ? 1 : 0; this.move = move; this.currentMove().rewind(); }
  isMoveDone(f) { if (this.move === MOVE_NONE) return true; const m = this.currentMove(); return m.position >= f * m.numFrames; }

  vol(v) { return v / 127 * 0.8; }
  playRoadSound(road, pressed, result) {
    if (pressed) {
      const n = result === 1 ? 31 : result === 2 ? 28 : result === 4 ? 29 : 27;
      this.sfx.play(n >> 4, n & 15, 3, this.vol(100));
    } else this.sfx.play(1, road, 3, this.vol(127));
    this.setMove(road, pressed);
  }

  hit(part) {
    part.done = true;
    this.playRoadSound(part.road, 0, 0);
    let form = Math.floor(this.level / 3);
    if (!this.auto && !this.speedCourse && form !== 0) {
      if (++this.combo === 18) {
        this.sfx.play(1, 14, 4, this.vol(127));
        form--; this.combo = 0; this.level = form * 3; this.misses = 0;
        this.playEvo();
      } else this.showEvo(this.combo);
    }
    this.score.hit(part.road, form === 0 ? 2 : 1);
    if (this.speedCourse) {
      // the speed reached: from the lowest, by the square root of the share of the points scored
      const g = this.range;
      g.scored += this.score.lastBase + this.score.lastBonus;
      g.speed = g.min + (g.max - g.min) * Math.sqrt(Math.min(1, g.scored / g.points));
    }
  }

  miss(part) {
    part.done = true; part.missed = true;
    this.onMiss && this.onMiss();
    this.sfx.play(1, 10, 2, this.vol(127));
    this.combo = 0;
    this.showEvo(0);
    const form = Math.floor(this.level / 3);
    if (form === 0) { this.misses = 0; this.level = 3; }
    else if (++this.misses === 3) {
      this.misses = 0;
      if (this.level < 11) this.level++;
      else this.gameOver = true;
    }
    this.score.numPresses = 0;
    this.score.chain = 0;
  }

  showEvo(frame) {
    this.evoFrame = frame;
    if (this.evo.speed === 0 || this.evo.finished) { this.evoJitter = 10; this.evo.setSpeed(0); this.evo.seek(frame); }
  }
  playEvo() { this.evoFrame = 0; this.evoJitter = 5; this.evo.setSpeed(1); }

  addEvent(e) {
    if (e.type === 'part') {
      if (e.time < 0 || e.time >= this.endTime) return;
      const length = this.speedCourse ? e.length : Math.floor(e.scale * e.length);
      const rate = 1 / (length >> 6);
      const part = { road: e.value, time: e.time, rate, effect: this.effectOn(e.time), position: 0, done: false, missed: false, pressed: 0, other: 0 };
      const first = firstRoad(e.value), second = secondRoad(e.value);
      for (let i = 1; i < 4; i++) { const o = (first + i) % 4; if (o !== first && o !== second) { part.other = o; break; } }
      this.parts.push(part);
    } else if (e.type === 'effect') {
      if (e.effect === 'screw' && !this.speedCourse) this.effect = { from: e.time, to: e.time + e.length };
    } else if (e.type === 'camera') {
      this.camera.event(e.value);
    } else if (e.type === 'quiet') {
      this.quietAt = e.time;
    } else if (e.type === 'shot') {
      this.camera.shot(e.camera, e.loops, e.side);
    } else if (e.type === 'break') {
      this.camera.break();
    }
  }
  effectOn(t) { return !!this.effect && t >= this.effect.from && t < this.effect.to; }

  // `position`: the music heard, in samples from the start of the track; `pressed`: road bits pressed this frame
  update(position, pressed, dt) {
    if (this.analyser) {
      if (this.speedCourse) {
        const period = Math.floor(RATE / this.range.speed);
        this.analyser.fixed = { period, selectPeriod: period * 3 };
      }
      for (const e of this.analyser.advance(position + DELAY)) this.pending.push(e);
      while (this.pending.length && this.pending[0].deliver <= position) this.addEvent(this.pending.shift());
    }
    if (this.auto) pressed = 0;

    // in a speed course, all the parts come as fast
    const common = this.speedCourse ? this.speed / (RATE >> 6) : 0;
    for (const p of this.parts) p.position = (common || p.rate) * ((p.time - position) >> 6);
    this.parts.sort((a, b) => a.position - b.position);
    while (this.parts.length && this.parts[0].position < -3 - VIBRI) this.parts.shift();

    let current = null, passed = null, next = null, pending = null;
    for (const p of this.parts) {
      if (!current && p.position >= -WINDOW && p.position < WINDOW) current = p;
      if (!passed && p.position > -1 && p.position <= 0) passed = p;
      if (p.position >= -1 && (!next || p.time < next.time)) next = p;
      if (!p.done && (!pending || p.time < pending.time)) pending = p;
    }

    if (pressed && this.isMoveDone(MOVE_DONE)) {
      if (current) {
        if (!current.done) {
          current.pressed |= pressed;
          if (current.pressed === ROAD_BUTTONS[current.road]) this.hit(current);
          else if (current.pressed & ~ROAD_BUTTONS[current.road]) this.miss(current);
        }
      } else {
        for (let road = 0; road < 4; road++) {
          if (ROAD_BUTTONS[road] & pressed) {
            const result = pending ? this.score.press(road, pending.road) : 0;
            this.playRoadSound(road, 1, result);
            break;
          }
        }
      }
    }
    for (const p of this.parts) {
      if (this.auto && !p.done && !(p.position > 0)) this.hit(p);
      if (p.position < -WINDOW && !p.done && !this.auto) this.miss(p);
    }

    if (!passed && !current && !this.result) {
      if (position >= this.endTime) {
        if (this.speedCourse) { this.timeUp = true; this.result = 'over'; }
        else this.result = 'clear';
      } else if (this.gameOver) this.result = 'over';
    }

    const seconds = Math.floor(position / RATE);
    if (this.speedCourse) {
      // the speed catches up with the one the points reached
      if (this.speed < this.range.speed) this.speed += this.speed * 0.002 * dt * 50;
      if (!passed && !current && this.speed >= this.range.max && !this.result) { this.clearSeconds = seconds; this.result = 'clear'; }
    } else if (this.levelMode) {
      // a level's camera follows its own shots and breaks
    } else if (!this.home) {
      const brk = seconds >= 0 && seconds % 60 >= 52;
      if (brk !== this.cameraBreak && brk) this.camera.break();
      this.cameraBreak = brk;
    } else if (this.quietAt !== null && position >= this.quietAt) {
      this.quietAt = null;
      this.camera.break();
    }

    if (next && !this.speedCourse) this.speed = next.rate * (RATE >> 6);

    const pieces = [];
    for (const p of this.parts) {
      if (p.position >= DISTANCE - VIBRI + 3) break;
      pieces.push({ object: p.road, position: p.position + VIBRI, missed: p.missed, leaning: p.effect });
    }
    if (current && current.time !== this.lastPartTime) { this.newPart = true; this.lastPartTime = current.time; }
    const passedDone = passed && passed.done;
    const hit = passedDone && !passed.missed;
    const missed = passedDone && passed.missed;
    if (this.newPart && missed) { this.newPart = false; this.beatTime = position; this.beatPeriod = passed.rate; }
    let shake = 1 - this.beatPeriod * ((position - this.beatTime) >> 6);
    if (shake < 0 || shake > 1) shake = 0;
    this.frame = { pieces, still: !!(current || hit), shake, form: Math.floor(this.level / 3), stage: this.level % 3, seconds, time: position / RATE, missed: !!missed, dt };
  }

  // ---------- the scene ----------
  draw(r) { this.drawScene(r); this.drawHud(r); }

  drawScene(r) {
    const f = this.frame;
    if (!f) return;
    const dt = f.dt;
    if (f.form !== this.lastCharacter) {
      const from = this.moves[this.character][this.move][this.alternate];
      this.character = f.form;
      const to = this.moves[f.form][this.move][this.alternate];
      if (from.position < to.numFrames) to.seek(from.position); else to.rewind();
      this.lastCharacter = f.form;
    }
    const speedJitter = 14 * f.stage + 10;
    const jitter = f.still ? 0 : speedJitter;
    const length = DISTANCE, start = VIBRI, offset = -length / 2;
    const cameraCoord = translation(0, 0, Math.trunc((offset + start) * 600));
    this.camera.update(r, cameraCoord, dt);
    // a level's own camera, where its keyframes say
    const free = this.freeKeys && this.freeKeys.length ? freeCameraAt(this.freeKeys, f.time) : null;
    if (free) { r.view.setFov(free.fov); r.view.lookAt(free.eye, free.target, free.roll, cameraCoord); }
    this.cameraCoord = cameraCoord;

    // the road's two ends, far enough out to reach the sides of a widescreen view
    const ends = [-length * 12, length * 12];
    const join = { x: 0, y: 0, z: ends[0] * 600 };
    const drawPiece = (obj, position, missed, lean) => {
      const m = rotZYX(0, 0, lean);
      r.drawObject(obj, m, { zOffset: Math.trunc((offset + position) * 600), jitter: missed ? speedJitter * 5 : jitter * 1.5, join });
    };
    const side = this.camera.sideNow();
    drawPiece(this.point, ends[0], false, 0);
    for (const p of f.pieces) {
      let lean = 0;
      if (p.leaning) {
        const d = (p.position - start - 0.5) * 512;
        const l = d > 0 ? ((Math.trunc(d * 409.6 * 128 / (length * 65536)) << 16 >> 16) * 8) : 0;
        lean = side ? l : -l;
      }
      drawPiece(this.road[p.object], p.position, p.missed, lean);
    }
    drawPiece(this.point, ends[1], false, 0);

    // Vibri
    const charCoord = translation(0, 0, Math.trunc((offset + start) * 600));
    const cj = f.shake > 0 ? jitter + f.shake * jitter * 8 : jitter;
    const movie = this.currentMove();
    movie.setSpeed(this.speed * 0.5);
    movie.draw(r, charCoord, dt, { jitter: cj });
    if (movie.finished) { this.alternate = 0; this.move = MOVE_NONE; this.currentMove().rewind(); }

    this.evo.draw(r, charCoord, dt, { jitter: this.evoJitter });
    if (this.evo.speed > 0 && this.evo.position > EVO_ENDS[this.character]) { this.evo.setSpeed(0); this.evo.seek(this.evoFrame); }
  }

  // the meters and signs over the scene
  drawHud(r) {
    const f = this.frame;
    if (!f) return;
    const dt = f.dt;
    if (this.speedCourse) {
      this.speedCam.update(r, null, 0);
      const frameOf = (m, s) => Math.max(0, Math.min(m.numFrames - 1, m.numFrames / (METER_MAX - METER_MIN) * (s - METER_MIN)));
      this.dial.draw(r, null, 0, { jitter: 3 });
      this.target.seek(frameOf(this.target, this.range.max));
      this.target.draw(r, null, 0, { jitter: 3 });
      this.needle.seek(frameOf(this.needle, this.range.speed));
      this.needle.draw(r, null, 0, { jitter: 3 });
      this.labels[COURSES[this.course].label].draw(r, null, dt, { jitter: 3 });
      this.timeCam.update(r, null, 0);
      this.timeMovie.seek(Math.min(1, Math.max(0, f.seconds / this.courseSeconds)) * (this.timeMovie.numFrames - 1));
      this.timeMovie.draw(r, null, 0, { jitter: 3 });
    } else if (!this.auto) {
      lookAlongZ(r, -2906, 294);
      const marks = toMarks(Math.min(this.score.points, MAX_SCORE));
      const combo = this.combo / 18;
      const speed = combo * combo * 9 + 1;
      this.scoreMovie.seek(this.scoreFrame);
      this.scoreMovie.setSpeed(-speed);
      const swapped = this.marks.slice();
      for (let i = 0; i < 7; i++) {
        swapped[0] = this.marks[marks[i]] || this.marks[0];
        if (i > 0) this.scoreMovie.seek((this.scoreFrame + 20 * i) % this.scoreMovie.numFrames);
        this.scoreMovie.draw(r, null, i === 0 ? dt : undefined, { objects: swapped, jitter: 4 });
        if (i === 0) this.scoreFrame = this.scoreMovie.position;
      }
      this.timeCam.update(r, null, 0);
      let gone = Math.min(1, Math.max(0, f.seconds / this.courseSeconds));
      this.timeMovie.seek(gone * (this.timeMovie.numFrames - 1));
      this.timeMovie.draw(r, null, 0, { jitter: 3 });
    } else {
      this.autoCam.update(r, null, 0);
      this.autoMovie.draw(r, null, dt, { jitter: 3 });
    }
    if (this.home) {
      this.roundCam.update(r, null, 0);
      this.roundMovies[this.roundIndex % 2].draw(r, null, dt, { jitter: 3 });
    }
  }

  getScore() { return Math.min(this.score.points, MAX_SCORE); }
  getBonus() { return Math.floor(this.score.points * RANK_BONUS[Math.floor(this.level / 3)] / 100); }
  getRank() { return Math.floor(this.level / 3); }
}
