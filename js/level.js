// Levels made in the editor: a song, the obstacles on it, the game's camera
// shots and the breaks between them, twists of the road, and free camera
// keyframes. Saved as a small .vibl file (JSON); the song itself is never in it.
import { RATE, DELAY, analyseTrack } from './analysis.js';

export const ROADS = [
  { name: 'Block', short: 'B' }, { name: 'Pit', short: 'P' }, { name: 'Loop', short: 'L' }, { name: 'Wave', short: 'W' },
  { name: 'Block + Pit', short: 'BP' }, { name: 'Block + Loop', short: 'BL' }, { name: 'Block + Wave', short: 'BW' },
  { name: 'Pit + Loop', short: 'PL' }, { name: 'Pit + Wave', short: 'PW' }, { name: 'Loop + Wave', short: 'LW' },
];
// the road of a set of single roads pressed together (bits: block 1, pit 2, loop 4, wave 8)
export const ROAD_OF_BITS = { 1: 0, 2: 1, 4: 2, 8: 3, 3: 4, 5: 5, 9: 6, 6: 7, 10: 8, 12: 9 };
export const SHOTS = [
  { id: 1, name: 'Behind 1' }, { id: 2, name: 'Behind 2' }, { id: 3, name: 'Side 1' }, { id: 4, name: 'Side 2' },
  { id: 5, name: 'Front 1' }, { id: 6, name: 'Front 2' }, { id: 7, name: 'Front 3' },
];
export const DEFAULT_SPEED = 2; // road units a second, the game's own pace
const VIEW_UNITS = 14;          // how far ahead an obstacle must be added to come into view in time

export function newLevel(song, name = 'New level') {
  return {
    format: 'vibl', version: 1, id: Math.random().toString(36).slice(2, 10), name, song,
    bpm: 120, offset: 0, speed: DEFAULT_SPEED,
    parts: [], speeds: [], shots: [], breaks: [], twists: [], keys: [],
  };
}

// a level the editor can trust: fields filled in, times sorted
export function cleanLevel(l) {
  const n = newLevel(l.song || { kind: 'disc', track: 1 }, l.name || 'Level');
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  const lv = Object.assign(n, {
    id: l.id || n.id, bpm: num(l.bpm, 120), offset: num(l.offset, 0), speed: num(l.speed, DEFAULT_SPEED),
    parts: (l.parts || []).map(p => ({ t: num(p.t, 0), road: Math.max(0, Math.min(9, p.road | 0)), speed: p.speed ? num(p.speed, 0) : 0 })),
    shots: (l.shots || []).map(s => ({ t: num(s.t, 0), camera: Math.max(1, Math.min(7, s.camera | 0 || 2)), loops: Math.max(1, Math.min(9, s.loops | 0 || 2)), side: s.side ? 1 : 0 })),
    speeds: (l.speeds || []).map(c => ({ t: num(c.t, 0), speed: Math.max(MIN_SPEED, Math.min(MAX_SPEED, num(c.speed, DEFAULT_SPEED))), ramp: !!c.ramp })),
    breaks: (l.breaks || []).map(b => ({ t: num(b.t, 0) })),
    twists: (l.twists || []).map(w => ({ t: num(w.t, 0), length: Math.max(0.1, num(w.length, 4)) })),
    keys: (l.keys || []).map(k => ({
      t: num(k.t, 0), mode: k.mode === 'game' ? 'game' : 'free', ease: ['smooth', 'linear', 'cut'].includes(k.ease) ? k.ease : 'smooth',
      eye: (k.eye || [0, -800, -3000]).map(v => num(v, 0)), target: (k.target || [0, -300, 0]).map(v => num(v, 0)),
      roll: num(k.roll, 0), fov: num(k.fov, 400),
    })),
  });
  sortLevel(lv);
  return lv;
}
export function sortLevel(l) { for (const k of ['parts', 'speeds', 'shots', 'breaks', 'twists', 'keys']) l[k].sort((a, b) => a.t - b.t); }

// ---------- speed ----------
export const MIN_SPEED = 0.3, MAX_SPEED = 8;
// the speed of the road at `t`: the level's own, then each change from its time on
// (a ramp gets there gradually from the change before it)
export function speedAt(level, t) {
  const c = level.speeds;
  let i = -1;
  for (let k = 0; k < c.length; k++) if (c[k].t <= t) i = k; else break;
  const next = c[i + 1];
  const from = i >= 0 ? c[i].speed : level.speed || DEFAULT_SPEED;
  if (next && next.ramp) {
    const t0 = i >= 0 ? c[i].t : 0;
    const u = next.t > t0 ? Math.max(0, Math.min(1, (t - t0) / (next.t - t0))) : 1;
    return from + (next.speed - from) * u;
  }
  return from;
}
// an obstacle's speed: its own, or the road's at its time
export const partSpeed = (level, p) => p.speed || speedAt(level, p.t);

// ---------- the level played: events for the game, as the analyser gives them ----------
// Each event comes `deliver` samples into the track; advance() hands over the ones
// the analysis would have reached by then (it runs DELAY ahead of the sound).
export class LevelSource {
  constructor(level) {
    const events = [];
    const at = t => Math.round(t * RATE);
    for (const p of level.parts) {
      const speed = partSpeed(level, p);
      const length = Math.max(256, Math.round(RATE / speed));
      events.push({ type: 'part', time: at(p.t), value: p.road, length, scale: 1, deliver: at(p.t - VIEW_UNITS / speed - 1) });
    }
    for (const s of level.shots) events.push({ type: 'shot', time: at(s.t), camera: s.camera, loops: s.loops, side: s.side, deliver: at(s.t) });
    for (const b of level.breaks) events.push({ type: 'break', time: at(b.t), deliver: at(b.t) });
    for (const w of level.twists) events.push({ type: 'effect', effect: 'screw', time: at(w.t), length: at(w.length), deliver: at(w.t - 12) });
    events.sort((a, b) => a.deliver - b.deliver);
    this.events = events;
    this.taken = 0;
    this.fixed = null;
  }
  advance(captureTime) {
    const out = [];
    const until = captureTime - DELAY;
    while (this.taken < this.events.length && this.events[this.taken].deliver <= until) out.push(this.events[this.taken++]);
    return out;
  }
}

// ---------- the free camera ----------
// The view at `t` seconds from the keyframes, or null where the game's camera shows.
export function freeCameraAt(keys, t) {
  let i = -1;
  for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) i = k; else break;
  if (i < 0 || keys[i].mode === 'game') return null;
  const a = keys[i], b = keys[i + 1];
  if (!b || b.mode !== 'free' || a.ease === 'cut' || b.t <= a.t) return a;
  let u = (t - a.t) / (b.t - a.t);
  if (a.ease === 'smooth') u = u * u * (3 - 2 * u);
  const mix = (x, y) => x + (y - x) * u;
  return {
    eye: a.eye.map((v, j) => mix(v, b.eye[j])), target: a.target.map((v, j) => mix(v, b.target[j])),
    roll: mix(a.roll, b.roll), fov: mix(a.fov, b.fov),
  };
}

// ---------- a level from the music, as the game would make it ----------
// `opts`: the analyser's (fsl, round, prepare, autoBreaks); `home`: one of the disc's own songs
export function generateLevel(pcm, opts, song, name, home) {
  const events = analyseTrack(pcm, opts);
  const level = newLevel(song, name);
  const seconds = pcm.length / RATE;
  const cameras = [];
  for (const e of events) {
    if (e.type === 'part') {
      const length = Math.floor(e.scale * e.length) || RATE / DEFAULT_SPEED;
      level.parts.push({ t: round(e.time / RATE), road: e.value, speed: round(RATE / length) });
    } else if (e.type === 'effect' && e.effect === 'screw' && e.length > 0) {
      level.twists.push({ t: round(e.time / RATE), length: round(e.length / RATE) });
    } else if (e.type === 'camera') cameras.push({ t: e.time / RATE, value: e.value });
    else if (e.type === 'quiet' && home) level.breaks.push({ t: round(e.time / RATE) });
  }
  // the player's own songs: a break eight seconds before each minute is up
  if (!home) for (let m = 0; m * 60 + 52 < seconds; m++) level.breaks.push({ t: m * 60 + 52 });
  // a shot at the start, and one at each break: the camera the analysis chose by then
  const shotAt = (t, side) => {
    let value = 21;
    for (const c of cameras) if (c.t <= t + DELAY / RATE) value = c.value; else break;
    return { t: round(t), camera: value % 10 || 2, loops: Math.floor(value / 10) || 2, side };
  };
  let side = 0;
  level.shots.push(shotAt(0, side));
  for (const b of level.breaks) { side ^= 1; level.shots.push(shotAt(b.t + 0.01, side)); }
  level.breaks = [];
  // the parts' speeds as changes of the road's speed where they change
  if (level.parts.length) level.speed = level.parts[0].speed;
  let now = level.speed;
  for (const p of level.parts) {
    if (Math.abs(p.speed - now) > now * 0.12) { level.speeds.push({ t: p.t, speed: p.speed, ramp: false }); now = p.speed; }
    p.speed = 0;
  }
  sortLevel(level);
  return level;
}
const round = v => Math.round(v * 1000) / 1000;

// ---------- keeping levels ----------
const KEY = 'vibrib.levels';
export function savedLevels() {
  try { return (JSON.parse(localStorage.getItem(KEY)) || []).map(cleanLevel); } catch { return []; }
}
export function saveLevel(level) {
  const all = savedLevels().filter(l => l.id !== level.id);
  all.unshift(level);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { }
}
export function deleteLevel(id) {
  try { localStorage.setItem(KEY, JSON.stringify(savedLevels().filter(l => l.id !== id))); } catch { }
}
export function exportLevel(level) {
  const blob = new Blob([JSON.stringify(level, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (level.name || 'level').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.vibl';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export async function importLevel(file) {
  const l = JSON.parse(await file.text());
  if (l.format !== 'vibl') throw new Error(`${file.name} is not a level file`);
  return cleanLevel(Object.assign(l, { id: undefined }));
}
