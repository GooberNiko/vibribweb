// Frame-by-frame animations: model movies (.ANM) and camera movies (.ANC).
import { identity, mul, rotZYX, scaleCols } from './render.js';

export class Movie {
  constructor(numFrames, rate, loop) {
    this.numFrames = numFrames;
    this.rate = rate;          // movie frames per second
    this.speed = 1;
    this.loop = loop;
    this.finished = false;
    this.position = 0.5;
  }
  setSpeed(s) { this.speed = s; }
  rewind(backwards = false) { this.finished = false; this.position = backwards ? this.numFrames - 0.5 : 0.5; }
  seek(p) { this.position = p; }
  // goes on by `dt` seconds; one that does not loop stops at its last frame
  advance(dt) {
    const step = this.rate * this.speed * dt;
    if (this.loop) {
      let p = this.position + step;
      p = ((p % this.numFrames) + this.numFrames) % this.numFrames;
      this.position = p;
      this.finished = false;
    } else {
      let p = this.position + step;
      if (p < 0) p = 0;
      else if (p >= this.numFrames) p = this.numFrames - 1e-6;
      if (p === this.position) { this.finished = true; return; }
      this.position = p;
      this.finished = false;
    }
  }
  frame() { return Math.max(0, Math.min(this.numFrames - 1, Math.floor(this.position))); }
}

export class ModelMovie extends Movie {
  // `model`: array of TMD objects (may be swapped by the caller); `anm`: readAnm()
  constructor(model, anm, loop = false) {
    super(anm.count, anm.rate, loop);
    this.model = model;
    this.anm = anm;
    this.jitter = 0;
    this.passes = 1;
  }
  // draws the objects of the current frame under `parent`, then goes on
  draw(r, parent, dt, opts = {}) {
    const keys = this.anm.frames[this.frame()] || [];
    const objects = opts.objects || this.model;
    for (const k of keys) {
      const obj = objects[k.obj];
      if (!obj) continue;
      let m = k.rot ? rotZYX(k.rot[0], k.rot[1], k.rot[2]) : identity();
      if (k.scale) m = scaleCols(m, k.scale);
      if (k.pos) { m[9] = k.pos[0]; m[10] = k.pos[1]; m[11] = k.pos[2]; }
      if (opts.hide && opts.hide.has(obj)) continue;
      const jitter = opts.jitterOf ? opts.jitterOf(k.obj, obj) : opts.jitter ?? this.jitter;
      r.drawObject(obj, parent ? mul(parent, m) : m, { jitter, passes: opts.passes ?? this.passes, color: opts.color });
    }
    if (dt !== undefined) this.advance(dt);
    return keys.length;
  }
}

export class CameraMovie extends Movie {
  constructor(anc, loop = false) {
    super(anc.count, anc.rate, loop);
    this.anc = anc;
  }
  // sets the view from the current frame (mirrored left to right with `mirror`), then goes on
  update(r, parent, dt, mirror = false) {
    const f = this.anc.frames[this.frame()];
    const sx = mirror ? -1 : 1;
    this.last = { eye: [sx * f.x, f.y, f.z], target: [sx * f.tx, f.ty, f.tz], roll: f.roll, fov: f.fov };
    r.view.setFov(f.fov);
    r.view.lookAt([sx * f.x, f.y, f.z], [sx * f.tx, f.ty, f.tz], f.roll, parent);
    if (dt !== undefined) this.advance(dt);
  }
}

// The view of the meters and signs: looking straight along z (to depth `targetZ`).
export function lookAlongZ(r, z, fov, x = 0, targetZ = 0) {
  r.view.setFov(fov);
  r.view.lookAt([x, 0, z], [x, 0, targetZ], 0, null);
}
// LookAlongZ() as the game calls it, with its fixed-point numbers: positions in
// sixteenths, the field of view in 360ths of a turn's 65536ths
export function lookAlongFixed(r, x, y, z, targetZ, fov) {
  r.view.setFov(fov * 65536 / 360);
  r.view.lookAt([x * 16, y * 16, z * 16], [x * 16, y * 16, targetZ * 16], 0, null);
}

export { identity };
