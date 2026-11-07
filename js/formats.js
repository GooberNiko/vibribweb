// Parsers for the game's own file formats, read from the player's disc.

const dvOf = b => new DataView(b.buffer, b.byteOffset, b.byteLength);

// ---------- FILES.PAK: count, offsets, then (name\0 padded to 4, length, data) ----------
export function readPak(bytes) {
  const dv = dvOf(bytes);
  const n = dv.getUint32(0, true);
  const files = new Map();
  for (let i = 0; i < n; i++) {
    const o = dv.getUint32(4 + i * 4, true);
    let e = o;
    while (bytes[e]) e++;
    const name = new TextDecoder().decode(bytes.subarray(o, e));
    const p = (e + 1 + 3) & ~3;
    const len = dv.getUint32(p, true);
    files.set(name.toUpperCase(), bytes.subarray(p + 4, p + 4 + len));
  }
  return {
    files,
    get(name) {
      const f = files.get(name.toUpperCase());
      if (!f) throw new Error(`${name} missing from FILES.PAK`);
      return f;
    },
    has(name) { return files.has(name.toUpperCase()); },
  };
}

// ---------- TMD: line models ----------
// Each object: vertices (x,y,z) and lines [v0, v1, r, g, b]. Flat quads give the line
// from their first vertex to their last; a black triangle of blue 0 is a back-face marker.
export function readTmd(bytes) {
  const dv = dvOf(bytes);
  const n = dv.getUint32(8, true);
  const base = 12;
  const objects = [];
  for (let i = 0; i < n; i++) {
    const o = base + i * 28;
    const vtop = dv.getUint32(o, true), nv = dv.getUint32(o + 4, true);
    const ptop = dv.getUint32(o + 16, true), np = dv.getUint32(o + 20, true);
    const verts = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      const q = base + vtop + v * 8;
      verts[v * 3] = dv.getInt16(q, true);
      verts[v * 3 + 1] = dv.getInt16(q + 2, true);
      verts[v * 3 + 2] = dv.getInt16(q + 4, true);
    }
    const lines = [];
    let cull = null;
    let p = base + ptop;
    for (let k = 0; k < np; k++) {
      const ilen = bytes[p + 1], mode = bytes[p + 3];
      const d = p + 4;
      const r = bytes[d], g = bytes[d + 1], b = bytes[d + 2];
      if (mode === 0x40) {
        lines.push([dv.getInt16(d + 4, true), dv.getInt16(d + 6, true), r, g, b]);
      } else if (mode === 0x29) {
        lines.push([dv.getInt16(d + 4, true), dv.getInt16(d + 10, true), r, g, b]);
      } else if (mode === 0x21) {
        const v0 = dv.getInt16(d + 4, true), v1 = dv.getInt16(d + 6, true), v2 = dv.getInt16(d + 8, true);
        if (r === 0 && g === 0 && (b === 0 || b === 1)) {
          if (b === 0) cull = [v0, v1, v2];
        } else {
          // a plain triangle takes a line slot the game never fills: nothing drawn
        }
      }
      p += (ilen + 1) * 4;
    }
    objects.push({ verts, lines, cull, nv });
  }
  return objects;
}

// ---------- ANM: model movies ----------
function movieHeader(dv) {
  if (dv.getInt16(0, true) === -0x8000) return { rate: dv.getInt16(2, true), count: dv.getInt16(4, true), table: 6 };
  return { rate: 60, count: dv.getInt16(0, true), table: 2 };
}

export function readAnm(bytes) {
  const dv = dvOf(bytes);
  const { rate, count, table } = movieHeader(dv);
  const offs = [];
  for (let i = 0; i <= count; i++) offs.push(dv.getUint16(table + i * 2, true) * 2);
  const frames = [];
  for (let f = 0; f < count; f++) {
    const keys = [];
    let p = offs[f];
    const end = offs[f + 1];
    while (p < end) {
      const obj = bytes[p], flags = bytes[p + 1];
      p += 2;
      const k = { obj, rot: null, scale: null, pos: null };
      if (flags & 1) { k.rot = [dv.getInt16(p, true), dv.getInt16(p + 2, true), dv.getInt16(p + 4, true)]; p += 6; }
      if (flags & 2) { k.scale = [dv.getInt16(p, true), dv.getInt16(p + 2, true), dv.getInt16(p + 4, true)]; p += 6; }
      if (flags & 4) { k.pos = [dv.getInt16(p, true), dv.getInt16(p + 2, true), dv.getInt16(p + 4, true)]; p += 6; }
      keys.push(k);
    }
    frames.push(keys);
  }
  return { rate, count, frames };
}

// ---------- ANC: camera movies ----------
export function readAnc(bytes) {
  const dv = dvOf(bytes);
  const { rate, count, table } = movieHeader(dv);
  const frames = [];
  for (let f = 0; f < count; f++) {
    const p = table + f * 16;
    const v = [];
    for (let k = 0; k < 8; k++) v.push(dv.getInt16(p + k * 2, true));
    frames.push({ x: v[0], y: v[1], z: v[2], tx: v[3], ty: v[4], tz: v[5], roll: v[6], fov: v[7] });
  }
  return { rate, count, frames };
}

// ---------- FSL: the analysis script ----------
export function readFsl(bytes) {
  const dv = dvOf(bytes);
  let p = 0;
  const i32 = () => { const v = dv.getInt32(p, true); p += 4; return v; };
  const h = {
    numSpeedLists: i32(), numPartLists: i32(), numEffectLists: i32(), numTracks: i32(),
    numPatterns: i32(), numDistributions: i32(), numRounds: i32(), numSongs: i32(), numMedleys: i32(),
  };
  const ints = n => Array.from({ length: n }, i32);
  const roundTracks = ints(h.numRounds), songTracks = ints(h.numSongs), medleyTracks = ints(h.numMedleys);
  const patterns = [];
  for (let i = 0; i < h.numPatterns; i++) patterns.push(ints(i32()));
  const distributions = [];
  for (let i = 0; i < h.numDistributions; i++) {
    const unused = i32(), seed = i32(), total = i32();
    distributions.push({ unused, seed, total, below: ints(10) });
  }
  const list = (fields) => {
    const n = i32();
    const out = [];
    for (let k = 0; k < n; k++) {
      const e = {};
      for (const f of fields) e[f] = i32();
      out.push(e);
    }
    return out;
  };
  const speedLists = [], partLists = [], effectLists = [];
  for (let i = 0; i < h.numSpeedLists; i++) speedLists.push(list(['time', 'period', 'selectPeriod', 'periodSlope', 'selectPeriodSlope']));
  for (let i = 0; i < h.numPartLists; i++) partLists.push(list(['time', 'unused', 'type', 'index']));
  for (let i = 0; i < h.numEffectLists; i++) effectLists.push(list(['time', 'tempoLength', 'tempoPattern', 'reverseLength', 'screwLength', 'camera']));
  const tracks = [];
  for (let i = 0; i < h.numTracks; i++) tracks.push({ speeds: i32(), parts: i32(), effects: i32() });
  return { header: h, roundTracks, songTracks, medleyTracks, patterns, distributions, speedLists, partLists, effectLists, tracks };
}

// ---------- VAB (.VH + .VB): sound effects, PlayStation ADPCM ----------
const ADPCM_F = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];

function decodeVag(vb, start, size) {
  const blocks = size >> 4;
  const out = new Float32Array(blocks * 28);
  let s1 = 0, s2 = 0, n = 0, loopStart = 0, loop = false;
  for (let b = 0; b < blocks; b++) {
    const o = start + b * 16;
    const shift = vb[o] & 15, filter = Math.min(4, vb[o] >> 4), flags = vb[o + 1];
    const [f0, f1] = ADPCM_F[filter];
    if (flags & 4) loopStart = n;
    for (let i = 0; i < 28; i++) {
      const byte = vb[o + 2 + (i >> 1)];
      let nib = (i & 1) ? byte >> 4 : byte & 15;
      if (nib & 8) nib -= 16;
      let s = (nib << 12) >> shift;
      s += (s1 * f0 + s2 * f1 + 32) >> 6;
      s = Math.max(-32768, Math.min(32767, s));
      s2 = s1; s1 = s;
      out[n++] = s / 32768;
    }
    if (flags & 1 && b > 0) { loop = !!(flags & 2); break; } // the end: back to the loop start, or silence
  }
  const samples = out.subarray(0, n);
  samples.loop = loop;
  samples.loopStart = loopStart;
  return samples;
}

export function readVab(vh, vb) {
  const dv = dvOf(vh);
  const ps = dv.getUint16(18, true);   // programs
  const vs = dv.getUint16(22, true);   // waveforms
  const mvol = vh[24];
  const progBase = 32;
  const toneBase = progBase + 128 * 16;
  const sizeBase = toneBase + ps * 16 * 32;
  const offsets = [0];
  let acc = 0;
  for (let i = 1; i <= vs; i++) { offsets[i] = acc; acc += dv.getUint16(sizeBase + i * 2, true) * 8; }
  const sizes = [];
  for (let i = 1; i <= vs; i++) sizes[i] = dv.getUint16(sizeBase + i * 2, true) * 8;
  const vagCache = new Map();
  const programs = [];
  for (let p = 0; p < ps; p++) {
    const tones = vh[progBase + p * 16];
    const pvol = vh[progBase + p * 16 + 1];
    const list = [];
    for (let t = 0; t < tones; t++) {
      const o = toneBase + (p * 16 + t) * 32;
      const vol = vh[o + 2], center = vh[o + 4], shift = vh[o + 5];
      const vag = dv.getInt16(o + 22, true);
      if (!vagCache.has(vag)) vagCache.set(vag, decodeVag(vb, offsets[vag], sizes[vag]));
      list.push({ vol, center, shift, samples: vagCache.get(vag), volume: (mvol * pvol >> 7) * vol / (127 * 127) });
    }
    programs.push(list);
  }
  return programs;
}

// The results' texts are the game's own, read from the player's MAIN_G.EXE: tables of
// pointers to its strings, a row per language (German, English, Spanish, French,
// Italian, Japanese). Where the tables are in the PAL executable (SCES-02873):
const TEXT_TABLES = {
  courseNames: [0x544d8, 5], bonus: [0x54550, 3], clearComments: [0x54598, 4], steps: [0x545f8, 10],
  speed: [0x546e8, 3], failComments: [0x54730, 5], end: [0x547a8, 2],
};
export function readGameTexts(exe) {
  const empty = Object.fromEntries(Object.entries(TEXT_TABLES).map(([k, [, cols]]) => [k, Array.from({ length: 6 }, () => Array(cols).fill(''))]));
  if (!exe || exe.length < 0x54800) return empty;
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const base = dv.getUint32(0x18, true);
  if (base !== 0x80019000) return empty; // another release: its tables are elsewhere
  const str = p => {
    if (!p) return '';
    const o = p - base + 0x800;
    if (o < 0x800 || o >= exe.length) return '';
    let e = o;
    while (e < exe.length && exe[e]) e++;
    return String.fromCharCode(...exe.subarray(o, e));
  };
  const out = {};
  for (const [k, [at, cols]] of Object.entries(TEXT_TABLES)) {
    out[k] = Array.from({ length: 6 }, (_, row) => Array.from({ length: cols }, (_, col) => str(dv.getUint32(at + (row * cols + col) * 4, true))));
  }
  return out;
}
