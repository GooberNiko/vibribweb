// The camera of a course: one camera's movie played a number of times, until a
// break starts a transition movie to the next camera, which the track's camera
// events choose (loops * 10 + camera id).
import { CameraMovie } from './movie.js';

const BACK = 0, SIDE = 1, FRONT = 2;
const CAMERAS = [
  { id: 1, name: 'B01', group: BACK }, { id: 2, name: 'B02', group: BACK },
  { id: 3, name: 'S01', group: SIDE }, { id: 4, name: 'S02', group: SIDE },
  { id: 5, name: 'F01', group: FRONT }, { id: 6, name: 'F02', group: FRONT }, { id: 7, name: 'F03', group: FRONT },
];
const TRANSITIONS = [
  ['TV_BS', 'TA_BS', BACK, SIDE], ['TV_BF', 'TA_BF', BACK, FRONT], ['TV_SF', 'TA_SF', SIDE, FRONT],
  ['TV_BB', 'TA_BB', BACK, BACK], ['TV_SS', 'TA_SS', SIDE, SIDE], ['TV_FF', 'TA_FF', FRONT, FRONT],
];

export class GameCamera {
  constructor(assets) {
    this.cameras = CAMERAS.map(c => ({ ...c, movie: new CameraMovie(assets.anc(`ROAD/${c.name}.ANC`)) }));
    this.transitions = TRANSITIONS.map(([same, sw, from, to]) => ({
      from, to, sameSide: new CameraMovie(assets.anc(`ROAD/${same}.ANC`)), switchSide: new CameraMovie(assets.anc(`ROAD/${sw}.ANC`)),
    }));
    this.reset(false, false);
  }
  setNext(camera, loops) { this.eventCamera = camera; this.eventLoops = loops; }
  takeNext(side) { this.nextSide = side; this.nextCamera = this.eventCamera; this.nextLoops = this.eventLoops; }
  startBase() {
    this.camera = this.nextCamera;
    this.side = this.nextSide;
    this.loopsDone = 0;
    this.numLoops = this.nextLoops;
    this.movie = this.cameras[this.camera].movie;
    this.inTransition = false;
    this.flip = !!this.side;
    this.movie.rewind();
    this.movie.setSpeed((this.fast ? 1.3 : 1) * this.nextLoops / 2);
  }
  startTransition() {
    const from = this.cameras[this.camera].group, to = this.cameras[this.nextCamera].group;
    let t = this.transitions.findLast(x => x.from === from && x.to === to);
    let reverse = false;
    if (!t) { reverse = true; t = this.transitions.findLast(x => x.from === to && x.to === from); }
    const switchSide = this.side !== this.nextSide;
    this.movie = switchSide ? t.switchSide : t.sameSide;
    this.inTransition = true;
    this.movie.rewind(reverse);
    this.movie.setSpeed(reverse ? -1 : 1);
    this.flip = !!(this.side ^ (reverse && switchSide ? 1 : 0));
  }
  // `fast`: the movies run faster (and keep to one side); `hold`: a camera loops on
  reset(fast, hold) {
    this.fast = fast;
    this.hold = hold;
    this.waiting = true;
    this.setNext(2, 1);
    this.takeNext(1);
    this.startBase();
    this.break();
  }
  event(value) {
    let loops = Math.floor(value / 10);
    const id = value % 10;
    if (loops <= 0) loops = 2;
    let camera = this.cameras.findIndex(c => c.id === id);
    if (camera < 0) camera = 0;
    this.setNext(camera, loops);
    if (this.waiting) {
      this.waiting = false;
      this.takeNext(0);
      this.startBase();
      this.takeNext(0);
      this.startTransition();
    }
  }
  // a level's shot: on to `id`'s camera for `loops`, on `side`, through a transition
  shot(id, loops, side) {
    let camera = this.cameras.findIndex(c => c.id === id);
    if (camera < 0) camera = 0;
    this.waiting = false;
    this.setNext(camera, Math.max(1, loops));
    this.takeNext(side ? 1 : 0);
    this.startTransition();
  }
  break() {
    this.takeNext(this.fast ? 0 : this.side ^ 1);
    this.startTransition();
  }
  update(r, parent, dt) {
    this.movie.update(r, parent, dt, this.flip);
    if (this.movie.finished) {
      if (!this.inTransition) {
        if (this.hold || ++this.loopsDone < this.numLoops) this.movie.rewind();
      } else this.startBase();
    }
  }
  sideNow() { return this.inTransition ? this.nextSide : this.side; }
}
