// Listening to the music for where the obstacles go.
// The game's script (SYSTEM3.FSL) says what kinds of obstacle come at each
// time of a song and how far apart; an onset finder places each one where
// the sound gets louder. Any music can be played this way, as on the
// original's "put in your own CD" mode.

export const RATE = 22050;     // the analysis works on mono sound at this rate
export const BLOCK = 128;      // samples a block
export const DELAY = 1379 * BLOCK; // the sound is analysed this far ahead of being heard (8 s)
const FRAME = 441;             // samples a frame of the game (PAL)
const MIN_LEVEL = 999999;

// ---------- random numbers (Numerical Recipes' generator) ----------
export const nextRandom = s => (Math.imul(s, 1664525) + 1013904223) >>> 0;
const below = (s, n) => Math.floor(s * n / 4294967296);

export function randomPicks(lo, hi, count, seed, picks) {
  for (let i = 0; i < 7; i++) seed = nextRandom(seed);
  const range = hi - lo + 1;
  const used = [];
  for (let done = 0; done < count;) {
    const first = done;
    done = Math.min(count, done + range);
    let top = hi;
    used.length = 0;
    for (let i = first; i < done; i++) {
      seed = nextRandom(seed);
      let pick = lo + below(seed, top - lo + 1);
      for (let j = 0; j < used.length; j++) { if (pick < used[j]) break; pick++; }
      picks[i] = pick;
      let at = 0;
      while (at < used.length && used[at] < pick) at++;
      used.splice(at, 0, pick);
      top--;
    }
  }
  return picks;
}

// ---------- what chooses the obstacles ----------
class RoadSequence {
  constructor(list) { this.list = list; this.i = 0; }
  next() { const r = this.list[this.i++]; if (this.i >= this.list.length) this.i = 0; return r; }
}

class RoadDraw {
  constructor(odds, round, seed) { this.odds = odds; this.seed = Math.imul(odds.seed, (Math.imul(100, seed) + round) | 0) >>> 0; }
  next() {
    this.seed = nextRandom(this.seed);
    const pick = below(this.seed, this.odds.total) + 1;
    for (let r = 0; r < 10; r++) if (this.odds.below[r] >= pick) return r;
    return 9;
  }
}

// How long the parts are for a while: their lengths scaled in turns or at random.
class RoadTempo {
  constructor(start, length, pattern, seed) { this.start = start; this.length = length >>> 0; this.pattern = pattern; this.seed = seed >>> 0; this.turn = 0; }
  isOver(t) { return ((t - this.start) >>> 0) > this.length; }
  next(t) {
    if (this.isOver(t)) return 1;
    switch (this.pattern) {
      case 2: this.seed = nextRandom(this.seed); return below(this.seed, 10) < 5 ? 1.25 : 0.5;
      case 3: { this.seed = nextRandom(this.seed); const r = below(this.seed, 10); return r < 3 ? 1.25 : r >= 7 ? 0.5 : 1 / 1.5; }
      case 22: if (++this.turn >= 2) this.turn = 0; return this.turn === 0 ? 1.25 : 0.5;
      default: if (++this.turn >= 3) this.turn = 0; return this.turn === 0 ? 1.25 : this.turn === 1 ? 1 / 1.5 : 0.5;
    }
  }
}

// ---------- the script ----------
export class AnalysisScript {
  constructor(fsl, emit) {
    this.f = fsl;
    this.emit = emit; // (event, captureTime)
    this.prepare(true, 1, 0, []);
  }

  // `fixedOrder`: the game's own disc; `trackSeconds`: of each track of another disc
  prepare(fixedOrder, count, seed, trackSeconds) {
    const h = this.f.header;
    count = Math.min(count, 100);
    this.fixedOrder = fixedOrder;
    this.seed = seed | 0;
    this.playing = false;
    this.order = [];
    this.starts = [];
    if (fixedOrder) {
      for (let i = 0; i <= count; i++) { this.order[i] = i; this.starts[i] = 0; }
    } else if (h.numMedleys > 0) {
      randomPicks(0, count - 1, count, seed >>> 0, this.order);
      this.track = this.f.medleyTracks[0];
      this.setTrackLists();
      for (let j = 1; j <= count; j++) this.starts[this.order[j - 1]] = trackSeconds[j - 1] * RATE;
      let rest = this.end;
      for (let k = 0; k < count; k++) rest -= this.starts[k];
      if (rest < 0) rest = 0;
      const gaps = randomPicks(0, rest, count, seed >>> 0, []).sort((a, b) => a - b);
      let done = this.starts[0];
      this.starts[0] = gaps[0];
      for (let l = 1; l < count; l++) { const start = done; done += this.starts[l]; this.starts[l] = start + gaps[l]; }
    } else {
      for (let m = 0; m < count; m++) this.starts[m] = 0;
      randomPicks(0, h.numSongs - 1, count, seed >>> 0, this.order);
    }
  }

  setTrackLists() {
    const t = this.f.tracks[this.track];
    this.parts = this.f.partLists[t.parts];
    this.speeds = this.f.speedLists[t.speeds];
    this.effects = this.f.effectLists[t.effects];
    this.end = Math.max(this.parts.at(-1).time, this.speeds.at(-1).time, this.effects.at(-1).time);
  }

  // round `round` (the CD's audio track, from 1) starts at `startTime`
  start(round, startTime) {
    round = Math.min(round, 100);
    this.patternSel = [];
    this.distSel = [];
    this.tempo = null;
    this.round = round;
    this.startTime = startTime;
    this.playing = true;
    this.effectIndex = 0;
    if (this.fixedOrder) { this.track = this.f.roundTracks[round - 1]; this.offset = 0; }
    else if (this.f.header.numMedleys > 0) { this.track = this.f.medleyTracks[0]; this.offset = this.starts[this.order[round - 1]]; }
    else { this.track = this.f.songTracks[this.order[round - 1]]; this.offset = 0; }
    this.setTrackLists();
    this.now = this.offset;
    this.catchUp();
  }

  find(list, t) {
    let lo = 0, hi = list.length;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (list[mid].time <= t) lo = mid; else hi = mid; }
    return lo;
  }

  findCurrent() {
    this.partIndex = this.find(this.parts, this.now);
    const part = this.parts[this.partIndex];
    if (part.type === 1 && !this.patternSel[part.index]) this.patternSel[part.index] = new RoadSequence(this.f.patterns[part.index]);
    if (part.type === 2 && !this.distSel[part.index]) this.distSel[part.index] = new RoadDraw(this.f.distributions[part.index], this.round, this.seed);
    this.speedIndex = this.find(this.speeds, this.now);
  }

  at(e) { return this.startTime + e.time - this.offset; }
  sendTempo(e) {
    if (e.tempoLength > 0) {
      this.tempo = new RoadTempo(this.at(e), e.tempoLength, e.tempoPattern, e.time);
      this.emit({ type: 'effect', effect: 'tempo', time: this.at(e), length: e.tempoLength });
    }
  }
  sendReverse(e) { if (e.reverseLength > 0) this.emit({ type: 'effect', effect: 'reverse', time: this.at(e), length: e.reverseLength }); }
  sendScrew(e) { if (e.screwLength > 0) this.emit({ type: 'effect', effect: 'screw', time: this.at(e), length: e.screwLength }); }
  sendCamera(e) { if (e.camera >= 0) this.emit({ type: 'camera', time: this.at(e), value: e.camera }); }

  catchUp() {
    let camera = -1;
    for (; this.effectIndex < this.effects.length; this.effectIndex++) {
      const e = this.effects[this.effectIndex];
      if (this.now < e.time) break;
      if (this.now < e.tempoLength + e.time) this.sendTempo(e);
      if (this.now < e.reverseLength + e.time) this.sendReverse(e);
      if (this.now < e.screwLength + e.time) this.sendScrew(e);
      if (e.camera >= 0) camera = this.effectIndex;
    }
    if (camera >= 0) this.sendCamera(this.effects[camera]);
  }

  sendEffects() {
    while (this.effectIndex < this.effects.length) {
      const e = this.effects[this.effectIndex];
      if (this.now < e.time) break;
      this.sendTempo(e); this.sendReverse(e); this.sendScrew(e); this.sendCamera(e);
      this.effectIndex++;
    }
  }

  // the road part at `time`: {period, selectPeriod, selector, tempo}
  nextPart(time, select, fixed) {
    if (!this.playing) return { period: fixed ? fixed.period : RATE, selectPeriod: fixed ? fixed.selectPeriod : (RATE * 0.1) | 0, selector: null, tempo: null };
    this.now = Math.min(Math.max(0, time - this.startTime) + this.offset, this.end);
    this.sendEffects();
    this.findCurrent();
    let period, selectPeriod;
    if (fixed) { period = fixed.period; selectPeriod = fixed.selectPeriod; }
    else if (this.speedIndex === this.speeds.length - 1) {
      const s = this.speeds[this.speedIndex];
      period = s.period; selectPeriod = s.selectPeriod;
    } else {
      const s = this.speeds[this.speedIndex];
      const since = this.now - s.time;
      period = s.period + (Math.imul(s.periodSlope, since) >> 12);
      selectPeriod = s.selectPeriod + (Math.imul(s.selectPeriodSlope, since) >> 12);
    }
    period = Math.max(1, period);
    selectPeriod = Math.max(1, selectPeriod);
    let selector = null;
    const part = this.parts[this.partIndex];
    if (select) {
      if (part.type === 1) selector = this.patternSel[part.index];
      else if (part.type === 2) selector = this.distSel[part.index];
    }
    return { period, selectPeriod, selector, tempo: fixed ? null : this.tempo };
  }
}

// ---------- the onset finder ----------
const isAbove = (level, bg, otherLevel, otherBg) => otherLevel * bg < level * otherBg;

class OnsetFinder {
  constructor(emit) { this.emit = emit; this.reset(0); }
  reset(time) {
    this.cue = null; this.candidate = null;
    this.windowStart = time; this.window = 0;
    this.history = new Array(32).fill(null); this.hi = 0;
    this.longLevel = 0; this.shortLevel = 0;
    this.time = 0; this.level = 0; this.background = 0; this.scale = 1; this.length = 0;
  }
  place() {
    this.emit({ type: 'part', time: this.time, value: this.cue.selector.next(), length: this.cue.period, scale: this.scale });
    this.cue = null;
  }
  takeCandidate() {
    this.cue = this.candidate;
    this.time = this.cTime; this.level = this.cLevel; this.background = this.cBg;
    this.candidate = null;
    this.scale = this.cue.tempo ? this.cue.tempo.next(this.time) : 1;
    this.length = Math.floor(this.scale * this.cue.period);
  }
  endWindow(time) {
    if (this.candidate) {
      if (this.cue) {
        if (this.cTime - this.time > 2 * this.length) { this.place(); this.takeCandidate(); }
        else if (isAbove(this.cLevel, this.cBg, Math.trunc(3 * this.level / 2), this.background)) this.takeCandidate();
        else this.candidate = null;
      } else this.takeCandidate();
    }
    if (this.cue && time - this.time > 2 * this.length) this.place();
  }
  // a block of BLOCK samples at `time`
  process(cue, time, samples) {
    this.history[this.hi] = samples;
    if (++this.hi >= 32) this.hi = 0;
    let ri = this.hi - 4; if (ri < 0) ri += 32;
    const recent = this.history[ri] || SILENCE;
    const oldest = this.history[this.hi] || SILENCE;
    let sl = this.shortLevel, ll = this.longLevel;
    for (let i = 0; i < BLOCK;) {
      const now = time + i;
      if (now - this.windowStart >= this.window) {
        this.windowStart += this.window;
        this.window = this.candidate ? this.candidate.selectPeriod : cue.selectPeriod;
        this.endWindow(this.windowStart);
        while (now - this.windowStart >= this.window) { this.windowStart += this.window; this.endWindow(this.windowStart); }
      }
      const end = Math.min(BLOCK, this.windowStart + this.window - time);
      let best = -1, bestShort = 0, bestLong = 1;
      for (; i < end; i++) {
        const s = samples[i], power = s * s;
        sl = (sl - ((recent[i] * recent[i]) >> 9) + (power >> 9)) | 0;
        ll = (ll - ((oldest[i] * oldest[i]) >> 12) + (power >> 12)) | 0;
        if (sl > MIN_LEVEL && isAbove(sl, ll, bestShort, bestLong)) { best = i; bestShort = sl; bestLong = ll; }
      }
      if (cue.selector && best >= 0) {
        if (this.candidate && !isAbove(bestShort, bestLong, this.cLevel, this.cBg)) continue;
        this.candidate = cue;
        this.cTime = time + best; this.cLevel = bestShort; this.cBg = bestLong;
      }
    }
    this.shortLevel = sl; this.longLevel = ll;
  }
}
const SILENCE = new Int16Array(BLOCK);

// Mono sound at RATE from 44100 Hz stereo, as the game captures it: every other sample, (L+R)/2.
export function toAnalysisPcm(left, right) {
  const n = Math.floor(left.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-32768, Math.min(32767, Math.round(left[i * 2] * 32768)));
    const r = Math.max(-32768, Math.min(32767, Math.round(right[i * 2] * 32768)));
    out[i] = (l + r) / 2 | 0;
  }
  return out;
}

// Listens to a track as it plays, DELAY ahead of what is heard, as the game does.
//   pcm: Int16Array mono at RATE; opts: {round, fsl, prepare: [fixedOrder, count, seed, secs], autoBreaks}
export class TrackAnalyser {
  constructor(pcm, opts) {
    this.pcm = pcm;
    this.opts = opts;
    this.events = [];
    this.captureTime = 0;
    const emit = e => { e.deliver = this.captureTime - DELAY; this.events.push(e); };
    this.script = new AnalysisScript(opts.fsl, emit);
    this.script.prepare(...opts.prepare);
    this.finder = new OnsetFinder(emit);
    this.emit = emit;
    this.total = Math.floor(pcm.length / BLOCK);
    this.block = 0;
    this.cue = null; this.hadSelector = false; this.frame = -1;
    this.fixed = null; // {period, selectPeriod}: a speed course's
    this.script.start(opts.round, 0);
    this.finder.reset(0);
    this.ended = false;
    this.taken = 0;
  }
  // analyses the sound up to `captureTime`; the events not taken yet
  advance(captureTime) {
    const o = this.opts;
    while (this.block < this.total && this.block * BLOCK <= captureTime) {
      const t = this.block * BLOCK;
      this.captureTime = t;
      const f = Math.floor(t / FRAME);
      if (f !== this.frame) {
        this.frame = f;
        let select = true;
        if (o.autoBreaks && !this.fixed) {
          // no obstacles in the last 8 seconds of each minute (heard time, 8 s ahead)
          const seconds = Math.floor((t - DELAY) / RATE);
          select = ((seconds + 8) % 60 + 60) % 60 < 52;
        }
        this.cue = this.script.nextPart(t, select, this.fixed);
        const has = !!this.cue.selector;
        if (!o.autoBreaks && this.hadSelector && !has) this.emit({ type: 'quiet', time: t });
        this.hadSelector = has;
      }
      this.finder.process(this.cue, t, this.pcm.subarray(t, t + BLOCK));
      this.block++;
    }
    if (this.block >= this.total && !this.ended) {
      this.ended = true;
      this.captureTime = this.total * BLOCK;
      this.finder.endWindow(this.captureTime + 10 * RATE); // the part waiting is placed
    }
    const out = this.events.slice(this.taken);
    this.taken = this.events.length;
    return out;
  }
}

// Works out every event of a track at once (for tests).
export function analyseTrack(pcm, opts) {
  const a = new TrackAnalyser(pcm, opts);
  a.advance(Infinity);
  return a.events;
}
