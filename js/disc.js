// Reads the player's own Vib-Ribbon disc image: a .zip, or .cue + .bin files.
// Nothing from the game ships with this page; every asset comes from here.

const SECTOR = 2352;

// ---------- zip ----------

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(file, onProgress) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const files = [];
  let done = 0;
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const ln = dv.getUint16(e.local + 26, true);
    const le = dv.getUint16(e.local + 28, true);
    const start = e.local + 30 + ln + le;
    const raw = buf.subarray(start, start + e.csize);
    let data;
    if (e.method === 0) data = raw.slice();
    else if (e.method === 8) data = await inflateRaw(raw);
    else throw new Error(`Unsupported zip compression in ${e.name}`);
    files.push({ name: e.name.split('/').pop(), data });
    onProgress && onProgress(++done / entries.length);
  }
  return files;
}

// ---------- cue ----------

function msf(s) {
  const [m, sec, f] = s.split(':').map(Number);
  return (m * 60 + sec) * 75 + f;
}

export function parseCue(text) {
  const tracks = [];
  let file = null, track = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    let m;
    if ((m = t.match(/^FILE\s+"(.+)"\s+(\S+)/i)) || (m = t.match(/^FILE\s+(\S+)\s+(\S+)/i))) {
      file = m[1];
    } else if ((m = t.match(/^TRACK\s+(\d+)\s+(\S+)/i))) {
      track = { number: +m[1], type: m[2].toUpperCase(), file, index0: null, index1: null };
      tracks.push(track);
    } else if ((m = t.match(/^INDEX\s+(\d+)\s+(\d+:\d+:\d+)/i)) && track) {
      if (+m[1] === 0) track.index0 = msf(m[2]);
      if (+m[1] === 1) track.index1 = msf(m[2]);
    }
  }
  return tracks;
}

// ---------- disc ----------

// `files`: [{name, data: Uint8Array}]
export function buildDisc(files) {
  const byName = new Map(files.map(f => [f.name.toLowerCase(), f.data]));
  const cueFile = files.find(f => f.name.toLowerCase().endsWith('.cue'));
  let tracks;
  if (cueFile) {
    tracks = parseCue(new TextDecoder().decode(cueFile.data));
  } else {
    const bins = files.filter(f => /\.(bin|img)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!bins.length) throw new Error('No .cue or .bin found');
    tracks = bins.map((b, i) => ({ number: i + 1, type: i === 0 ? 'MODE2/2352' : 'AUDIO', file: b.name, index0: 0, index1: i === 0 ? 0 : 150 }));
  }
  // resolve each track to a byte range
  const out = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const data = byName.get((t.file || '').toLowerCase());
    if (!data) throw new Error(`Missing file "${t.file}" listed in the cue sheet`);
    const next = tracks[i + 1];
    const startSector = t.index1 ?? 0;
    let endSector;
    if (next && next.file === t.file) endSector = next.index0 ?? next.index1;
    else endSector = Math.floor(data.length / SECTOR);
    out.push({ number: t.number, type: t.type, data, start: startSector * SECTOR, end: endSector * SECTOR });
  }
  const dataTrack = out.find(t => t.type !== 'AUDIO');
  if (!dataTrack) throw new Error('No data track on this disc');
  const audio = out.filter(t => t.type === 'AUDIO');
  return { dataTrack, audio, fs: new IsoFs(dataTrack) };
}

class IsoFs {
  constructor(track) {
    this.t = track;
    const type = track.type;
    this.raw = /2352/.test(type);
    this.mode2 = /MODE2/.test(type);
    const pvd = this.sector(16);
    if (String.fromCharCode(...pvd.subarray(1, 6)) !== 'CD001') throw new Error('Data track is not a PlayStation disc');
    this.files = new Map();
    this.walk(pvd.subarray(156, 190), '');
  }
  sector(lba) {
    const d = this.t.data;
    if (!this.raw) return d.subarray(this.t.start + lba * 2048, this.t.start + lba * 2048 + 2048);
    const off = this.t.start + lba * SECTOR + (this.mode2 ? 24 : 16);
    return d.subarray(off, off + 2048);
  }
  read(lba, size) {
    const out = new Uint8Array(size);
    for (let p = 0; p < size; p += 2048, lba++) {
      const s = this.sector(lba);
      out.set(s.subarray(0, Math.min(2048, size - p)), p);
    }
    return out;
  }
  walk(rec, path) {
    const dv = new DataView(rec.buffer, rec.byteOffset, rec.length);
    const data = this.read(dv.getUint32(2, true), dv.getUint32(10, true));
    let i = 0;
    while (i < data.length) {
      const len = data[i];
      if (len === 0) { i = (Math.floor(i / 2048) + 1) * 2048; continue; }
      const r = data.subarray(i, i + len);
      const rv = new DataView(r.buffer, r.byteOffset, r.length);
      const nl = r[32];
      const name = String.fromCharCode(...r.subarray(33, 33 + nl)).split(';')[0];
      i += len;
      if (nl === 1 && (r[33] === 0 || r[33] === 1)) continue;
      const full = path ? path + '/' + name : name;
      if (r[25] & 2) this.walk(r, full);
      else this.files.set(full.toUpperCase(), { lba: rv.getUint32(2, true), size: rv.getUint32(10, true) });
    }
  }
  has(name) { return this.files.has(name.toUpperCase()); }
  get(name) {
    const f = this.files.get(name.toUpperCase());
    if (!f) throw new Error(`File ${name} not on disc`);
    return this.read(f.lba, f.size);
  }
}

// CD audio of a track: 16-bit little-endian stereo at 44100 Hz
export function trackPcm(track) {
  const bytes = track.data.subarray(track.start, track.end);
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~3)));
}

// Collects dropped/picked files into [{name, data}], unpacking zips.
export async function gatherFiles(fileList, onProgress) {
  const out = [];
  for (const f of fileList) {
    if (/\.zip$/i.test(f.name)) out.push(...await readZip(f, onProgress));
    else out.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
  }
  return out;
}
