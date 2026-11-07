// What this browser keeps: settings and high scores (localStorage), and the
// player's disc, if they ask (IndexedDB, on this device only).

const SETTINGS = 'vibrib.settings';
const SCORES = 'vibrib.scores';

function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { } }

export const loadSettings = () => readJson(SETTINGS, {});
export const saveSettings = s => writeJson(SETTINGS, s);

export function highScores(course, defaults) {
  const all = readJson(SCORES, {});
  return all[course] || defaults.slice();
}
// the rank of `score` in the course's high scores (0: none), now in them
// (`lowerBetter`: a time, the shortest first)
export function recordHighScore(course, score, defaults, lowerBetter = false) {
  const all = readJson(SCORES, {});
  const list = all[course] || defaults.slice();
  let rank = 0;
  for (let i = 0; i < list.length; i++) {
    if (lowerBetter ? score < list[i] : score > list[i]) { list.splice(i, 0, score); list.length = defaults.length; rank = i + 1; break; }
  }
  all[course] = list;
  writeJson(SCORES, all);
  return rank;
}

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('vibrib', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('disc');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('disc', mode);
    const req = fn(t.objectStore('disc'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}
export const saveDisc = files => tx('readwrite', s => s.put(files.map(f => ({ name: f.name, data: new Blob([f.data]) })), 'files'));
export async function loadDisc() {
  const files = await tx('readonly', s => s.get('files'));
  if (!files) return null;
  return Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.data.arrayBuffer()) })));
}
export const forgetDisc = () => tx('readwrite', s => s.delete('files')).catch(() => {});
