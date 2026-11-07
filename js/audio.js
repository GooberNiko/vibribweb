// Music and sound effects.
import { RATE, toAnalysisPcm } from './analysis.js';

let ctx = null;
export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// A CD audio track (Int16 stereo at 44100) as an AudioBuffer.
export function pcmToBuffer(pcm) {
  const c = audioContext();
  const n = pcm.length >> 1;
  const buf = c.createBuffer(2, n, 44100);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) { L[i] = pcm[i * 2] / 32768; R[i] = pcm[i * 2 + 1] / 32768; }
  return buf;
}

// Any music file the browser can play, at 44100 Hz stereo as a CD would give it.
export async function decodeMusic(arrayBuffer) {
  const c = audioContext();
  const decoded = await c.decodeAudioData(arrayBuffer);
  if (decoded.sampleRate === 44100 && decoded.numberOfChannels === 2) return decoded;
  const off = new OfflineAudioContext(2, Math.ceil(decoded.duration * 44100), 44100);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

export function analysisPcm(buffer) {
  const L = buffer.getChannelData(0), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  return toAnalysisPcm(L, R);
}

// Plays a track; `position()` gives the sound heard, in RATE samples from the track's start.
export class MusicPlayer {
  constructor() { this.src = null; this.gain = null; this.startAt = 0; this.offsetMs = 0; this.paused = false; }
  // `from`: seconds into the track to start at
  play(buffer, leadIn, from = 0) {
    const c = audioContext();
    this.stop();
    this.gain = c.createGain();
    this.gain.connect(c.destination);
    this.src = c.createBufferSource();
    this.src.buffer = buffer;
    this.src.connect(this.gain);
    const at = c.currentTime + leadIn;
    this.startAt = at - from;
    this.src.start(at, Math.max(0, from));
    this.duration = buffer.duration;
  }
  position() {
    const c = audioContext();
    const latency = (c.outputLatency || c.baseLatency || 0);
    return Math.floor((c.currentTime - this.startAt - latency + this.offsetMs / 1000) * RATE);
  }
  pause() { if (ctx && ctx.state === 'running') { ctx.suspend(); this.paused = true; } }
  resume() { if (ctx && this.paused) { ctx.resume(); this.paused = false; } }
  stop() {
    if (this.src) { try { this.src.stop(); } catch { } this.src.disconnect(); this.src = null; }
    if (this.gain) { this.gain.disconnect(); this.gain = null; }
  }
}

// The game's sound effects (PSJ_SE), on voices: a new sound on a voice cuts the old one.
export class Sfx {
  constructor(programs) {
    this.programs = programs;
    this.buffers = new Map();
    this.voices = new Map();
    this.enabled = true;
    this.volume = 0.9;
  }
  buffer(prog, tone) {
    const key = prog * 16 + tone;
    if (this.buffers.has(key)) return this.buffers.get(key);
    const t = this.programs[prog] && this.programs[prog][tone];
    let buf = null;
    if (t && t.samples.length) {
      const note = tone + 1;
      const rate = 44100 * Math.pow(2, (note - t.center - t.shift / 128) / 12);
      const c = audioContext();
      buf = c.createBuffer(1, t.samples.length, Math.max(3000, Math.min(192000, rate)));
      buf.getChannelData(0).set(t.samples);
      buf.toneVolume = t.volume;
      buf.loopFrom = t.samples.loop ? t.samples.loopStart / buf.sampleRate : -1;
    }
    this.buffers.set(key, buf);
    return buf;
  }
  // a sound effect (game sounds follow the option; menu voices and music always play)
  play(prog, tone, voice, volume = 1, always = false) {
    if (!this.enabled && !always) return null;
    const buf = this.buffer(prog, tone);
    this.stop(voice);
    if (!buf) return null;
    const c = audioContext();
    const src = c.createBufferSource();
    src.buffer = buf;
    if (buf.loopFrom >= 0) { src.loop = true; src.loopStart = buf.loopFrom; src.loopEnd = buf.duration; }
    const g = c.createGain();
    g.gain.value = volume * buf.toneVolume * this.volume;
    src.connect(g); g.connect(c.destination);
    src.start();
    src.onended = () => { if (this.voices.get(voice) === src) this.voices.delete(voice); };
    this.voices.set(voice, src);
    return src;
  }
  stop(voice) {
    const old = this.voices.get(voice);
    if (old) { old.onended = null; try { old.stop(); } catch { } this.voices.delete(voice); }
  }
  isPlaying(voice) { return this.voices.has(voice); }
  stopAll() { for (const v of [...this.voices.keys()]) this.stop(v); }
}

// Sounds said one after the other on a voice (Vibri's lines, the menu music).
export class SoundSequence {
  constructor(sfx, voice) { this.sfx = sfx; this.voice = voice; this.playing = false; this.token = 0; }
  play(sounds, volume = 90) {
    this.stop();
    const list = Array.isArray(sounds) ? sounds : [sounds];
    const token = ++this.token;
    this.playing = true;
    const next = i => {
      if (token !== this.token) return;
      if (i >= list.length) { this.playing = false; return; }
      const n = list[i];
      const src = this.sfx.play(n >> 4, n & 15, this.voice, volume / 127, true);
      if (!src || src.loop) { if (!src) next(i + 1); return; }
      src.addEventListener('ended', () => next(i + 1));
    };
    next(0);
  }
  stop() { this.token++; if (this.playing) this.sfx.stop(this.voice); this.playing = false; }
}
