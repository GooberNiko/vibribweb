import { gatherFiles, buildDisc, trackPcm } from './disc.js';
import { loadAssets, loadTitleAssets, loadKioskAssets, languageCode, languageIndex } from './assets.js';
import { Renderer } from './render.js';
import { Gameplay, COURSES } from './gameplay.js';
import { TrackAnalyser } from './analysis.js';
import { audioContext, pcmToBuffer, decodeMusic, analysisPcm, MusicPlayer, Sfx } from './audio.js';
import { Input } from './input.js';
import { Title, SCREEN, RESULT, COURSE } from './title.js';
import { Intro, KioskScene } from './scene.js';
import * as store from './store.js';
import { Editor } from './editor.js';
import { LevelSource, generateLevel } from './level.js';
import { RATE } from './analysis.js';

const $ = id => document.getElementById(id);
const LEAD_IN = 8; // seconds the ribbon runs before the music is heard, as on the PlayStation
const STEP = 1 / 50; // the menus and scenes run frame by frame at the PAL rate
// the courses as the game numbers them
const COURSE_INDEX = { bronze: 0, silver: 1, gold: 2, one: 3, all: 4, speed1: 5, speed2: 6, speed3: 7, order: 8 };
const COURSE_KEYS = Object.keys(COURSE_INDEX);
// the demos played in turn when the title is left alone: levels of the game's own courses, and the kiosk scene
const DEMO_LEVELS = [1, 2, 3, 'kiosk', 4, 5, 6, 'kiosk'];

const state = {
  disc: null, assets: null, fsl: null, game: null, sfx: null, title: null,
  mode: 'load',       // load | intro | kiosk | title | playing | paused | editor
  overlay: null,      // an HTML panel over the title: music | options
  run: null,          // the course being played
  pending: null,      // the course chosen on the menus, waiting for its CD and track
  modeScreen: SCREEN.PSJ,
  menuScreen: SCREEN.MAIN, // the menu a course was started from, shown again after it
  songs: [],          // the player's own "CD": {name, buffer, seconds}
  intro: null, titleSfx: null, kiosk: null, demoCount: 0,
  settings: Object.assign({ sfx: true, vibration: true, offset: 0, language: 0x02, widescreen: true, languageChosen: false }, store.loadSettings()),
};
const music = new MusicPlayer();
const input = new Input();
let renderer;
window.vibrib = state; // for poking at in the console
// one frame of what is showing, for stepping by hand from the console (while the tab is hidden)
state.step = r => {
  if (state.mode === 'intro' && state.intro) introStep(r);
  else if (state.mode === 'kiosk' && state.kiosk) kioskStep(r);
  else if (state.mode === 'title') titleStep(r);
};

// ---------- panels ----------
function show(id) {
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id;
  $('titleHint').hidden = !((state.mode === 'title' || state.mode === 'intro') && !id);
  $('toEditor').hidden = !state.disc;
  const first = id && $(id).querySelector('button:not(:disabled)');
  if (first && id !== 'load') first.focus({ preventScroll: true });
}
const busy = on => { $('busy').hidden = !on; };
function status(el, text, error = false) { el.textContent = text; el.classList.toggle('error', error); }
function openOverlay(id) { state.overlay = id; show(id); }
function closeOverlay() { state.overlay = null; show(null); }

// ---------- the disc ----------
async function useFiles(files, remember) {
  const st = $('loadStatus');
  try {
    busy(true);
    status(st, 'Reading the disc…');
    const disc = buildDisc(files);
    if (!disc.fs.has('MAIN_G.EXE') || !disc.fs.has('GAME/AUDIO/PSJ_SE.VH')) throw new Error("This doesn't look like a Vib-Ribbon disc.");
    if (disc.audio.length < 6) throw new Error(`The disc's music is missing: found ${disc.audio.length} audio tracks, the game has 7. Include every .bin of the cue sheet.`);
    state.disc = disc;
    setLanguage(state.settings.language);
    if (remember) store.saveDisc(files).catch(() => {});
    status(st, '');
    startIntro(false);
  } catch (e) {
    console.error(e);
    status(st, e.message || String(e), true);
  } finally { busy(false); }
}

function setLanguage(code) {
  const assets = loadAssets(state.disc, code);
  state.assets = assets;
  state.fsl = assets.fsl();
  if (state.sfx) state.sfx.stopAll();
  state.sfx = new Sfx(assets.sounds());
  state.sfx.enabled = state.settings.sfx;
  state.game = new Gameplay(assets, state.sfx);
  state.game.onMiss = rumble;
  const screen = state.title ? state.title.screen : SCREEN.NONE;
  if (state.title) state.title.stop();
  state.title = new Title(assets, state.sfx);
  state.title.options = { soundEffects: state.settings.sfx ? 1 : 0, vibration: state.settings.vibration ? 1 : 0 };
  state.title.onOptions = o => {
    state.settings.sfx = !!o.soundEffects; state.settings.vibration = !!o.vibration;
    state.sfx.enabled = state.settings.sfx;
    store.saveSettings(state.settings);
    if (o.vibration) rumble();
  };
  state.title.onTrack = t => { state.chosenTrack = t; };
  state.title.highScores = allHighScores();
  const sel = $('optLang');
  sel.innerHTML = '';
  for (const l of assets.languages) sel.add(new Option(l.name, l.code, false, l.code === code));
  if (state.mode === 'title' && screen !== SCREEN.NONE && screen !== SCREEN.DONE) state.title.show(MENU_SCREENS.includes(screen) ? screen : SCREEN.MAIN);
}
const MENU_SCREENS = [SCREEN.MAIN, SCREEN.PSJ, SCREEN.UNKNOWN, SCREEN.SPEED, SCREEN.CD, SCREEN.TRACK, SCREEN.OPTION, SCREEN.PSJ_HISCORE, SCREEN.UNKNOWN_HISCORE];

function rumble() {
  if (!state.settings.vibration) return;
  for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
    const a = pad && pad.vibrationActuator;
    if (a && a.playEffect) a.playEffect('dual-rumble', { duration: 160, strongMagnitude: 0.9, weakMagnitude: 0.6 }).catch(() => {});
  }
}

// every course's high scores, three each, in the game's order
function allHighScores() {
  return COURSE_KEYS.flatMap(k => store.highScores(k, COURSES[k].highScores).slice(0, 3));
}

// ---------- the title executable: the intro, the language and mode menus ----------
function startIntro(returning) {
  music.stop();
  if (state.sfx) state.sfx.stopAll();
  if (state.title) state.title.stop();
  if (state.titleSfx) state.titleSfx.stopAll();
  const titleAssets = loadTitleAssets(state.disc, state.settings.language);
  if (!state.titleSfx) state.titleSfx = new Sfx(titleAssets.sounds());
  const languages = state.assets.languages.length > 1 && state.assets.languages.some(l => l.code === 0x04);
  state.intro = new Intro({
    assets: titleAssets, sfx: state.titleSfx, languages,
    firstRun: !returning && !state.settings.languageChosen,
    languageIndex: languageIndex(state.settings.language), returning,
  });
  state.mode = 'intro';
  state.overlay = null;
  show(null);
}

function introStep(r) {
  const out = state.intro.step(r, () => {
    const d = DEMO_LEVELS[state.demoCount++ % DEMO_LEVELS.length];
    state.demoLevel = d;
    return d === 'kiosk' ? (loadKioskAssets(state.disc, state.settings.language) ? 'kiosk' : null) : 'demo';
  });
  if (!out) return;
  if (out.language !== undefined) {
    const code = languageCode(out.language);
    state.settings.language = code; state.settings.languageChosen = true;
    store.saveSettings(state.settings);
    setLanguage(code);
    state.intro.setAssets(loadTitleAssets(state.disc, code));
    state.intro.languageSet();
  } else if (out.start === 'game') {
    state.titleSfx.stopAll();
    state.intro = null;
    state.mode = 'title';
    state.title.stop();
    state.title.show(SCREEN.MAIN);
    show(null);
  } else if (out.start === 'kiosk') startKiosk();
  else if (out.start === 'demo') startDemo();
}

// the kiosk demo scene, to one of the disc's songs
function startKiosk() {
  const k = loadKioskAssets(state.disc, state.settings.language);
  if (!k) { startIntro(true); return; }
  state.titleSfx.stopAll();
  const sfx = new Sfx(k.sounds());
  const scene = new KioskScene(k, sfx);
  // the 7th audio track (the game counts the audio tracks, after the data track): CD track 8
  const track = state.disc.audio[Math.min(6, state.disc.audio.length - 1)];
  music.offsetMs = 0;
  music.play(pcmToBuffer(trackPcm(track)), 0);
  state.kiosk = { scene, sfx, pressed: false };
  state.mode = 'kiosk';
  show(null);
}
function kioskStep(r) {
  const k = state.kiosk;
  k.scene.update(r);
  const pressed = k.pressed; k.pressed = false;
  if (k.scene.isFinished(pressed)) {
    music.stop();
    k.sfx.stopAll();
    state.kiosk = null;
    startIntro(true);
  }
}

// a demo: a track of the game's own courses, played by the game itself
function startDemo() {
  const level = state.demoLevel - 1;
  const course = ['bronze', 'silver', 'gold'][Math.floor(level / 2)];
  const round = COURSES[course].tracks[level % 2];
  state.titleSfx.stopAll();
  state.intro = null;
  state.run = { course, tracks: [() => homeTrack(round)], index: level % 2, score: 0, trackScore: 0, demo: true };
  playTrack();
}

// ---------- the level editor ----------
const discBuffers = new Map();
const editorApp = {
  game: () => state.game,
  renderer: () => renderer,
  music,
  busy,
  songChoices: () => [
    ...state.disc.audio.map((_, i) => ({ label: `Disc track ${i + 1}`, song: { kind: 'disc', track: i + 1 } })),
    ...state.songs.map(s => ({ label: s.name, song: { kind: 'file', name: s.name, seconds: Math.round(s.seconds) } })),
  ],
  songLabel: song => (song.kind === 'disc' ? `Disc track ${song.track}` : `${song.name} (${Math.floor(song.seconds / 60)}:${String(song.seconds % 60).padStart(2, '0')})`),
  // the song's sound: a track of the disc, or one of the player's (asked for when it is not in yet)
  loadSong(song) {
    if (song.kind === 'disc') {
      const track = state.disc.audio[song.track - 1];
      if (!track) return Promise.reject(new Error(`This disc has no track ${song.track}.`));
      if (!discBuffers.has(song.track)) discBuffers.set(song.track, pcmToBuffer(trackPcm(track)));
      return Promise.resolve(discBuffers.get(song.track));
    }
    const have = state.songs.find(s => s.name === song.name && Math.abs(s.seconds - song.seconds) < 2);
    if (have) return Promise.resolve(have.buffer);
    return new Promise((resolve, reject) => {
      const pick = document.createElement('input');
      pick.type = 'file'; pick.accept = 'audio/*';
      const missing = () => new Error(`This level needs the song "${song.name}".`);
      pick.onchange = async () => {
        if (!pick.files.length) { reject(missing()); return; }
        try { resolve((await editorApp.addSongFile(pick.files[0])).buffer); } catch (e) { reject(e); }
      };
      pick.oncancel = () => reject(missing());
      pick.click();
    });
  },
  async addSongFile(file) {
    const buffer = await decodeMusic(await file.arrayBuffer());
    const s = { name: file.name.replace(/\.[^.]+$/, ''), buffer, seconds: buffer.duration };
    state.songs.push(s);
    return s;
  },
  // a level as the game would make it from the song
  generate(song, buffer, name) {
    const pcm = analysisPcm(buffer);
    const home = song.kind === 'disc' && song.track <= 6;
    const opts = home
      ? { fsl: state.fsl, round: song.track, prepare: [true, 1, 0, []], autoBreaks: false }
      : { fsl: state.fsl, round: 1, prepare: [false, 1, (Math.floor(buffer.duration * 75) ^ 0xCBF633B1) >>> 0, [Math.floor(buffer.duration)]], autoBreaks: true };
    return generateLevel(pcm, opts, song, name, home);
  },
  playtest: (level, buffer, from) => playLevel(level, buffer, from),
  exit: () => { state.mode = 'title'; state.title.stop(); state.title.show(SCREEN.MAIN); show(null); },
};

function openEditor() {
  if (!state.disc) return;
  audioContext();
  music.stop();
  if (state.titleSfx) state.titleSfx.stopAll();
  if (state.title) state.title.stop();
  state.intro = null; state.kiosk = null;
  state.overlay = null;
  if (!state.editor) state.editor = new Editor(editorApp);
  state.mode = 'editor';
  show(null);
  state.editor.open();
}

// a level played as a course, from the start or from `from` seconds in
function playLevel(level, buffer, from = 0) {
  state.editor.close();
  let lv = level;
  if (from > 0) {
    const lastShot = level.shots.filter(s => s.t <= from).pop();
    lv = {
      ...level,
      parts: level.parts.filter(p => p.t >= from + 1.5),
      twists: level.twists.filter(w => w.t + w.length > from),
      breaks: level.breaks.filter(b => b.t > from),
      shots: [...(lastShot ? [{ ...lastShot, t: Math.max(0, from - 0.5) }] : []), ...level.shots.filter(s => s.t > from)],
    };
  }
  state.run = { course: 'level', tracks: [], index: 0, score: 0, trackScore: 0, levelTest: { level, buffer, from } };
  const endTime = Math.floor(buffer.duration * RATE);
  state.game.start({ course: 'level', analyser: new LevelSource(lv), seconds: Math.floor(buffer.duration), endTime, level: lv });
  music.offsetMs = state.settings.offset;
  music.play(buffer, from > 0 ? 3 : LEAD_IN, from);
  state.mode = 'playing';
  show(null);
}

function backToEditor(message) {
  music.stop();
  if (state.sfx) state.sfx.stopAll();
  state.run = null;
  state.mode = 'editor';
  show(null);
  state.editor.resume(message);
}

// ---------- the menus ----------
function toTitle(screen) {
  music.stop();
  state.sfx && state.sfx.stopAll();
  state.mode = 'title';
  state.run = null;
  state.overlay = null;
  show(null);
  state.title.highScores = allHighScores();
  if (state.title.screen === SCREEN.NONE || state.title.screen === SCREEN.DONE) state.title.show(screen);
  else state.title.goTo(screen);
}

// to a screen of the results, after a course, with the screens fading in from black
function toResults(screen, results) {
  music.stop();
  state.mode = 'title';
  state.overlay = null;
  show(null);
  const t = state.title;
  t.highScores = allHighScores();
  if (results) t.setResults(results);
  t.screen = SCREEN.DONE;
  t.goTo(screen);
}

function startPending(t) {
  state.menuScreen = t.screen;
  t.goTo(SCREEN.DONE);
}

function handleTitle(result) {
  const t = state.title;
  switch (result) {
    case RESULT.PSJ_MODES: state.modeScreen = SCREEN.PSJ; t.goTo(SCREEN.PSJ); break;
    case RESULT.UNKNOWN_MODES: state.modeScreen = SCREEN.UNKNOWN; t.goTo(SCREEN.UNKNOWN); break;
    case RESULT.OPTIONS: t.goTo(SCREEN.OPTION); break;
    case RESULT.LEAVE: startIntro(true); break;
    case RESULT.BRONZE: case RESULT.SILVER: case RESULT.GOLD: {
      const course = { [RESULT.BRONZE]: 'bronze', [RESULT.SILVER]: 'silver', [RESULT.GOLD]: 'gold' }[result];
      state.pending = { course, tracks: COURSES[course].tracks.map(round => () => homeTrack(round)) };
      startPending(t);
      break;
    }
    case RESULT.PSJ_HISCORES: t.goTo(SCREEN.PSJ_HISCORE); break;
    case RESULT.UNKNOWN_HISCORES: t.goTo(SCREEN.UNKNOWN_HISCORE); break;
    case RESULT.HISCORE_BACK: t.goTo(state.modeScreen); break;
    case RESULT.PSJ_BACK: case RESULT.UNKNOWN_BACK: case RESULT.OPTION_BACK: t.goTo(SCREEN.MAIN); break;
    case RESULT.ONE_TRACK: state.pending = { course: 'one' }; t.goTo(SCREEN.CD); break;
    case RESULT.ALL_TRACKS: state.pending = { course: 'all' }; t.goTo(SCREEN.CD); break;
    case RESULT.IN_ORDER: state.pending = { course: 'order' }; t.goTo(SCREEN.CD); break;
    case RESULT.SPEED_MODES: t.goTo(SCREEN.SPEED); break;
    case RESULT.SPEED_1: case RESULT.SPEED_2: case RESULT.SPEED_3:
      state.pending = { course: 'speed' + (result - RESULT.SPEED_1 + 1), fromSpeed: true };
      t.goTo(SCREEN.CD);
      break;
    case RESULT.SPEED_BACK: t.goTo(SCREEN.UNKNOWN); break;
    case RESULT.CD_CHANGE_BACK: t.goTo(state.pending && state.pending.fromSpeed ? SCREEN.SPEED : SCREEN.UNKNOWN); break;
    case RESULT.CHANGE_CD: openMusic(); break;
    case RESULT.CD_CHANGED: {
      if (!state.songs.length) { openMusic(); break; }
      const p = state.pending || { course: 'one' };
      if (p.course === 'one' || p.course.startsWith('speed')) {
        t.numTracks = state.songs.length;
        t.goTo(SCREEN.TRACK);
      } else {
        p.tracks = state.songs.map((_, i) => () => songTrack(i));
        startPending(t);
      }
      state.pending = p;
      break;
    }
    case RESULT.TRACK_BACK: t.goTo(SCREEN.CD); break;
    case RESULT.TRACK_CHOSEN: {
      const i = Math.min(state.songs.length, state.chosenTrack || 1) - 1;
      state.pending.tracks = [() => songTrack(i)];
      startPending(t);
      break;
    }
    // after a course
    case RESULT.RESULTS_DONE:
      if (t.screen === SCREEN.AGAIN) t.goTo(SCREEN.AGAIN_SELECT);
      else t.goTo(state.menuScreen);
      break;
    case RESULT.AGAIN: {
      const run = state.lastRun;
      t.goTo(SCREEN.DONE);
      // the game's own courses go on from the track that was lost; the others start again
      if (COURSES[run.course].home) { run.score = run.trackScore; state.pending = { resume: run }; }
      else state.pending = { course: run.course, tracks: run.tracks };
      break;
    }
    case RESULT.AGAIN_BACK: t.goTo(state.menuScreen); break;
  }
}

function openMusic() { openOverlay('music'); renderSongs(); }

// ---------- courses ----------
function homeTrack(round) {
  const pcm = trackPcm(state.disc.audio[round - 1]);
  return { buffer: pcmToBuffer(pcm), round, prepare: [true, 1, 0, []], autoBreaks: false };
}

function songTrack(index) {
  const secs = state.songs.map(s => Math.floor(s.seconds));
  return { buffer: state.songs[index].buffer, round: index + 1, prepare: [false, state.songs.length, discSeed(), secs], autoBreaks: true };
}

// an id of the player's "disc", from its tracks' lengths, as the game keys a CD by its contents
function discSeed() {
  let h = 0x811c9dc5;
  for (const s of state.songs) { h ^= Math.floor(s.seconds * 75); h = Math.imul(h, 16777619) >>> 0; }
  h ^= state.songs.length;
  return (h ^ 0xCBF633B1) >>> 0;
}

function startCourse(course, tracks) {
  audioContext();
  state.title.stop();
  state.run = { course, tracks, index: 0, score: 0, trackScore: 0 };
  playTrack();
}

function playTrack() {
  const run = state.run;
  busy(true);
  setTimeout(() => { // let the spinner paint before the work
    try {
      const t = run.tracks[run.demo ? 0 : run.index]();
      const pcm = analysisPcm(t.buffer);
      const analyser = new TrackAnalyser(pcm, { fsl: state.fsl, round: t.round, prepare: t.prepare, autoBreaks: t.autoBreaks });
      const seconds = Math.floor(t.buffer.duration);
      run.trackScore = run.score;
      state.game.start({ course: run.course, analyser, seconds, endTime: pcm.length, score: run.score, index: run.index, auto: !!run.demo });
      music.offsetMs = state.settings.offset;
      music.play(t.buffer, LEAD_IN);
      state.mode = 'playing';
      show(null);
    } catch (e) {
      console.error(e);
      alertResult('Error', e.message || String(e));
    } finally { busy(false); }
  }, 30);
}

function endTrack(result) {
  const run = state.run, g = state.game;
  music.stop();
  if (run.demo) { state.run = null; startIntro(true); return; }
  if (run.levelTest) {
    const at = Math.max(0, music.position() / RATE);
    backToEditor(result === 'clear' ? `Cleared! ${g.getScore()} points` : `Game over at ${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')} · ${g.getScore()} points`);
    return;
  }
  const course = COURSE_INDEX[run.course];
  const info = COURSES[run.course];
  state.lastRun = run;
  if (result === 'clear' && run.course === 'order') { toTitle(state.menuScreen); return; }
  if (result === 'clear' && g.getScore() > 0) {
    run.score = g.getScore();
    if (run.index + 1 < run.tracks.length) { run.index++; playTrack(); return; }
    const bonus = g.getBonus();
    const total = Math.min(run.score + bonus, 999999);
    const rank = g.speedCourse
      ? store.recordHighScore(run.course, g.clearSeconds, info.highScores, true)
      : store.recordHighScore(run.course, total, info.highScores);
    toResults(SCREEN.CLEAR, { course, score: run.score, bonus, seconds: g.clearSeconds, comment: [3, 1, 0, 2][g.getRank()], rank, timeUp: false });
    return;
  }
  // the course is lost (or cleared without a point)
  const score = g.getScore();
  const rank = g.speedCourse || run.course === 'order' ? 0 : store.recordHighScore(run.course, score, info.highScores);
  toResults(SCREEN.AGAIN, { course, score, bonus: 0, seconds: 0, rank, timeUp: g.timeUp });
}

// a course given up from the pause: straight to "try again?"
function quitCourse() {
  const run = state.run;
  music.stop();
  if (!run) { toTitle(SCREEN.MAIN); return; }
  if (run.demo) { state.run = null; startIntro(true); return; }
  if (run.levelTest) { backToEditor('Stopped'); return; }
  state.lastRun = run;
  toResults(SCREEN.AGAIN_SELECT, { course: COURSE_INDEX[run.course] });
}

function showResult(title, rows, actions) {
  state.mode = 'result';
  $('resultTitle').textContent = title;
  $('resultScore').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('hiscores').innerHTML = '';
  const nav = $('resultNav');
  nav.innerHTML = '';
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    nav.append(b);
  }
  show('result');
}
function alertResult(title, text) { music.stop(); showResult(title, [['', text]], [['Menu', () => toTitle(SCREEN.MAIN)]]); }

function pause() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  music.pause();
  show('pause');
}
function resume() {
  if (state.mode !== 'paused') return;
  music.resume();
  state.mode = 'playing';
  show(null);
}
input.onStart = () => {
  if (state.mode === 'playing' && state.run && state.run.demo) { quitCourse(); return; }
  if (state.mode === 'playing') pause();
  else if (state.mode === 'paused') resume();
  else if (state.overlay) closeOverlay();
};
input.active = () => state.mode === 'playing';
input.titleActive = () => (state.mode === 'title' || state.mode === 'intro' || state.mode === 'kiosk') && !state.overlay;
input.onTitleKey = key => {
  audioContext();
  if (state.mode === 'intro') state.intro.press(key);
  else if (state.mode === 'kiosk') { if (key === 'confirm' || key === 'back') state.kiosk.pressed = true; }
  else if (state.title) state.title.press(key);
};
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- the loop ----------
// The menus and scenes run whole frames of the game at 50 a second; the last
// one due is drawn and shown again until the next.
let acc = 0;
function lockstep(dt, step) {
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) { acc -= STEP; n++; }
  if (n === 5) acc = 0;
  if (!n) { renderer.replay(); return; }
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    renderer.muted = !last;
    if (last) renderer.record();
    step();
  }
  renderer.muted = false;
  renderer.stopRecording();
}

function titleStep(r) {
  if (state.mode !== 'title') return;
  const t = state.title;
  const result = t.step(r);
  if (result) handleTitle(result);
  if (t.screen === SCREEN.DONE && state.pending && (state.pending.tracks || state.pending.resume)) {
    const p = state.pending;
    state.pending = null;
    if (p.resume) { audioContext(); t.stop(); state.run = p.resume; playTrack(); }
    else startCourse(p.course, p.tracks);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const g = state.game;
  if (renderer) renderer.clear();
  if (renderer && state.mode === 'intro' && state.intro) {
    input.take();
    lockstep(dt, () => state.mode === 'intro' && state.intro && introStep(renderer));
  } else if (renderer && state.mode === 'editor' && state.editor) {
    input.take();
    state.editor.frame(dt, renderer);
  } else if (renderer && state.mode === 'kiosk' && state.kiosk) {
    input.take();
    lockstep(dt, () => state.kiosk && kioskStep(renderer));
  } else if (g && renderer) {
    if (state.mode === 'playing') {
      const pressed = input.take();
      // a demo plays itself; a button ends it
      if (state.run && state.run.demo && pressed) quitCourse();
      else {
        g.update(music.position(), pressed, dt);
        g.draw(renderer);
        if (g.result) endTrack(g.result);
      }
    } else if (state.mode === 'paused') {
      if (g.frame) { g.frame.dt = 0; g.draw(renderer); }
    } else if (state.mode === 'title') {
      input.take();
      const t = state.title;
      if (state.overlay) renderer.replay();
      else lockstep(dt, () => titleStep(renderer));
    } else if (state.mode === 'result' && g.frame) {
      g.frame.dt = dt;
      g.drawScene(renderer);
    }
  }
  requestAnimationFrame(frame);
}

// ---------- wiring ----------
function dropZone(zone, inputEl, onFiles) {
  inputEl.addEventListener('change', () => { if (inputEl.files.length) onFiles([...inputEl.files]); inputEl.value = ''; });
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputEl.click(); } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
}

async function addSongs(files) {
  const st = $('musicStatus');
  busy(true);
  status(st, '');
  try {
    for (const f of files) {
      status(st, `Reading ${f.name}…`);
      try {
        const buffer = await decodeMusic(await f.arrayBuffer());
        state.songs.push({ name: f.name.replace(/\.[^.]+$/, ''), buffer, seconds: buffer.duration });
      } catch { status(st, `Couldn't play ${f.name}`, true); }
    }
    if (!st.classList.contains('error')) status(st, '');
  } finally { busy(false); renderSongs(); }
}

function renderSongs() {
  const list = $('trackList');
  list.innerHTML = '';
  state.songs.forEach((s, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${String(i + 1).padStart(2, '0')}  ${s.name}`;
    const d = document.createElement('span');
    d.className = 'dur';
    d.textContent = `${Math.floor(s.seconds / 60)}:${String(Math.floor(s.seconds % 60)).padStart(2, '0')}`;
    li.append(name, d);
    list.append(li);
  });
  $('musicDone').textContent = state.songs.length ? `Done · ${state.songs.length} track${state.songs.length > 1 ? 's' : ''}` : 'Done';
}

function setWidescreen(on) {
  document.body.classList.toggle('wide', on);
  if (renderer) { renderer.resize(); renderer.last = null; }
}

function init() {
  setWidescreen(state.settings.widescreen);
  renderer = new Renderer($('screen'));
  state.renderer = renderer;
  window.addEventListener('resize', () => renderer.resize());

  dropZone($('drop'), $('discInput'), async files => {
    busy(true);
    try {
      status($('loadStatus'), 'Unpacking…');
      const all = await gatherFiles(files, p => status($('loadStatus'), `Unpacking… ${Math.round(p * 100)}%`));
      await useFiles(all, $('remember').checked);
    } catch (e) { status($('loadStatus'), e.message || String(e), true); busy(false); }
  });
  dropZone($('musicDrop'), $('musicInput'), addSongs);

  $('musicDone').onclick = closeOverlay;
  $('clearMusic').onclick = () => { state.songs = []; renderSongs(); };
  $('toSettings').onclick = () => openOverlay('options');
  $('toEditor').onclick = openEditor;
  for (const b of document.querySelectorAll('.back')) b.onclick = closeOverlay;
  $('resume').onclick = resume;
  $('quit').onclick = quitCourse;

  // a click on the screen picks the item the cursor is on; the wheel moves it
  $('screen').addEventListener('click', () => {
    if (state.overlay) return;
    audioContext();
    if (state.mode === 'title') state.title.press('confirm');
    else if (state.mode === 'intro') state.intro.press('confirm');
    else if (state.mode === 'kiosk') state.kiosk.pressed = true;
  });
  $('screen').addEventListener('wheel', e => {
    if (state.overlay) return;
    const key = e.deltaY > 0 ? 'down' : 'up';
    if (state.mode === 'title') state.title.press(key);
    else if (state.mode === 'intro') state.intro.press(key);
  }, { passive: true });

  const s = state.settings;
  $('optOffset').value = s.offset;
  $('optOffsetOut').textContent = `${s.offset} ms`;
  $('optOffset').oninput = e => { s.offset = +e.target.value; $('optOffsetOut').textContent = `${s.offset} ms`; store.saveSettings(s); };
  $('optLang').onchange = e => { s.language = +e.target.value; s.languageChosen = true; store.saveSettings(s); setLanguage(s.language); };
  $('optWide').checked = s.widescreen;
  $('optWide').onchange = e => { s.widescreen = e.target.checked; store.saveSettings(s); setWidescreen(s.widescreen); };
  $('forgetDisc').onclick = () => { store.forgetDisc(); $('forgetDisc').textContent = 'Forgotten'; };

  requestAnimationFrame(frame);

  show('load');
  store.loadDisc().then(files => {
    if (files && files.length) {
      status($('loadStatus'), 'Found your disc from last time…');
      return useFiles(files, false);
    }
  }).catch(() => {});
}

init();
