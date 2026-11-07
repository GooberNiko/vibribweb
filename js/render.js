// Draws the game's line models the way the PlayStation did: a 512x288 screen
// shown 4:3 (or wider, seeing more to the sides), a look-at camera
// (GsSetRefView2), perspective by `h`, and every vertex jittered a little
// each time it is drawn.

export const SCREEN_W = 512;
export const SCREEN_H = 288;
const TAU = Math.PI * 2;

// ---------- 3x4 matrices: [r00 r01 r02 r10 r11 r12 r20 r21 r22 tx ty tz] ----------
export function identity() { return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; }

export function mul(a, b) {
  const m = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      m[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
    m[9 + i] = a[i * 3] * b[9] + a[i * 3 + 1] * b[10] + a[i * 3 + 2] * b[11] + a[9 + i];
  }
  return m;
}

// RotMatrixZYX: angles in 4096ths of a turn
export function rotZYX(ax, ay, az) {
  const x = ax / 4096 * TAU, y = ay / 4096 * TAU, z = az / 4096 * TAU;
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx, 0, 0, 0];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy, 0, 0, 0];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1, 0, 0, 0];
  return mul(Rz, mul(Ry, Rx));
}

// ScaleMatrix: scales the columns (4096 is 1)
export function scaleCols(m, s) {
  const k = [s[0] / 4096, s[1] / 4096, s[2] / 4096];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] *= k[j];
  return m;
}

export function translation(x, y, z) { const m = identity(); m[9] = x; m[10] = y; m[11] = z; return m; }

function apply(m, x, y, z) {
  return [m[0] * x + m[1] * y + m[2] * z + m[9], m[3] * x + m[4] * y + m[5] * z + m[10], m[6] * x + m[7] * y + m[8] * z + m[11]];
}

// ---------- the view ----------
export class View {
  constructor() { this.ws = identity(); this.h = 480; }

  // SetProjection(): `fov` as the camera files give it (4096 a full turn)
  setFov(fov) {
    const a = (fov / 2) / 4096 * TAU;
    // (half of what SetProjection() reads as: the meters and signs, placed for this view, only fit with it)
    this.h = (Math.cos(a) / Math.sin(a)) * SCREEN_W * 3 / 16;
  }

  // GsSetRefView2: eye at vp, looking at vr, both in `parent`'s space; roll in 4096ths of a degree
  lookAt(vp, vr, roll, parent) {
    const e = parent ? apply(parent, vp[0], vp[1], vp[2]) : vp;
    const t = parent ? apply(parent, vr[0], vr[1], vr[2]) : vr;
    let f = [t[0] - e[0], t[1] - e[1], t[2] - e[2]];
    let l = Math.hypot(...f) || 1;
    f = f.map(v => v / l);
    // down is +y; the camera's y is the world's down made square to its view
    const d = f[1];
    let y = [-d * f[0], 1 - d * f[1], -d * f[2]];
    l = Math.hypot(...y);
    if (l < 1e-6) { y = [0, 0, 1]; l = 1; }
    y = y.map(v => v / l);
    let x = [y[1] * f[2] - y[2] * f[1], y[2] * f[0] - y[0] * f[2], y[0] * f[1] - y[1] * f[0]];
    if (roll) {
      const r = roll / 4096 * TAU, c = Math.cos(r), s = Math.sin(r);
      const nx = x.map((v, i) => c * v + s * y[i]), ny = y.map((v, i) => -s * x[i] + c * v);
      x = nx; y = ny;
    }
    const R = [x[0], x[1], x[2], y[0], y[1], y[2], f[0], f[1], f[2], 0, 0, 0];
    const T = translation(-e[0], -e[1], -e[2]);
    this.ws = mul(R, T);
  }
}

// ---------- drawing ----------
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = new View();
    this.scale = 1;
    this.lineWidth = 1;
    this.muted = false;     // draws nothing (a frame of the logic that is not shown)
    this.recording = null;  // the strokes drawn, kept to show again
    this.resize();
  }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    // the height is the PlayStation's; its pixels were 3/4 as wide as tall on a 4:3 set,
    // so a wider canvas shows more of the world to the left and right
    this.sy = this.canvas.height / SCREEN_H;
    this.sx = this.sy * 0.75;
    this.cx = this.canvas.width / 2;
    this.cy = this.canvas.height / 2;
    this.lineWidth = Math.max(1, this.sy * 0.9);
    this.last = null;
  }
  // keeps the strokes of the frame about to be drawn
  record() { this.recording = []; }
  // the strokes kept, to draw again while the logic has no new frame
  stopRecording() { this.last = this.recording; this.recording = null; return this.last; }
  replay(strokes = this.last) {
    if (!strokes) return;
    const ctx = this.ctx;
    for (const [color, pts] of strokes) {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 4) { ctx.moveTo(pts[i], pts[i + 1]); ctx.lineTo(pts[i + 2], pts[i + 3]); }
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
  clear() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = this.lineWidth;
  }

  // Draws one TMD object. `local`: its matrix in the world; `zOffset`: added to its z;
  // `jitter`: how far vertices move; `join`: {x,y,z} of the last object drawn, updated.
  drawObject(obj, local, { zOffset = 0, jitter = 0, passes = 1, join = null, color = null } = {}) {
    if (this.muted) return;
    const ls = mul(this.view.ws, local);
    if (obj.cull) {
      const [a, b, c] = obj.cull.map(i => this.project(ls, obj.verts[i * 3], obj.verts[i * 3 + 1], obj.verts[i * 3 + 2] + zOffset));
      if (a && b && c) {
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cross < 0) return;
      } else return;
    }
    const n = obj.nv;
    const range = Math.floor(jitter);
    for (let pass = 0; pass < passes; pass++) {
      const work = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const j = range > 0;
        work[i * 3] = obj.verts[i * 3] + (j ? jit(range) : 0);
        work[i * 3 + 1] = obj.verts[i * 3 + 1] + (j ? jit(range) : 0);
        work[i * 3 + 2] = obj.verts[i * 3 + 2] + zOffset + (j ? jit(range) : 0);
      }
      const scr = new Array(n);
      for (let i = 0; i < n; i++) scr[i] = this.project(ls, work[i * 3], work[i * 3 + 1], work[i * 3 + 2]);
      const ctx = this.ctx;
      let lastColor = '';
      let pts = [];
      ctx.beginPath();
      const rec = this.recording;
      const stroke = () => {
        if (lastColor) { ctx.strokeStyle = lastColor; ctx.stroke(); ctx.beginPath(); }
        if (rec && pts.length) rec.push([lastColor, pts]);
        pts = [];
      };
      for (const [v0, v1, r, g, b] of obj.lines) {
        const p0 = scr[v0], p1 = scr[v1];
        if (!p0 || !p1) continue;
        const col = color || `rgb(${r},${g},${b})`;
        if (col !== lastColor) { stroke(); lastColor = col; }
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        if (rec) pts.push(p0[0], p0[1], p1[0], p1[1]);
      }
      if (join) {
        // the line from the object before to this one's first vertex, clipped to the near plane
        const a = apply(ls, join.x, join.y, join.z);
        const b = apply(ls, work[0], work[1], work[2]);
        const seg = this.clipNear(a, b);
        if (seg) {
          const col = color || (obj.lines[0] ? `rgb(${obj.lines[0][2]},${obj.lines[0][3]},${obj.lines[0][4]})` : '#fff');
          if (col !== lastColor) { stroke(); lastColor = col; }
          ctx.moveTo(seg[0], seg[1]);
          ctx.lineTo(seg[2], seg[3]);
          if (rec) pts.push(seg[0], seg[1], seg[2], seg[3]);
        }
      }
      stroke();
      if (join && pass === passes - 1) {
        // hand on this object's last vertex, as drawn (in its own space; objects share a frame)
        join.x = work[(n - 1) * 3]; join.y = work[(n - 1) * 3 + 1]; join.z = work[(n - 1) * 3 + 2];
      }
    }
  }

  project(ls, x, y, z) {
    const X = ls[0] * x + ls[1] * y + ls[2] * z + ls[9];
    const Y = ls[3] * x + ls[4] * y + ls[5] * z + ls[10];
    const Z = ls[6] * x + ls[7] * y + ls[8] * z + ls[11];
    if (Z < 1) return null;
    const h = this.view.h;
    return [X * h / Z * this.sx + this.cx, Y * h / Z * this.sy + this.cy];
  }

  clipNear(a, b) {
    const near = this.view.h / 2;
    if (a[2] < near && b[2] < near) return null;
    if (a[2] < near) { const t = (near - a[2]) / (b[2] - a[2]); a = a.map((v, i) => v + (b[i] - v) * t); }
    else if (b[2] < near) { const t = (near - b[2]) / (a[2] - b[2]); b = b.map((v, i) => v + (a[i] - v) * t); }
    const h = this.view.h;
    return [a[0] * h / a[2] * this.sx + this.cx, a[1] * h / a[2] * this.sy + this.cy,
      b[0] * h / b[2] * this.sx + this.cx, b[1] * h / b[2] * this.sy + this.cy];
  }
}

// a whole number from -range to range - 1
function jit(range) { return Math.floor(Math.random() * range * 2) - range; }
