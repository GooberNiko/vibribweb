// Everything the game needs, read from the player's disc.
import { readPak, readTmd, readAnm, readAnc, readFsl, readVab, readGameTexts } from './formats.js';

// the languages, by their file prefix; `index` is the game's own numbering
// (German, English, Spanish, French, Italian, then Japanese)
export const LANGUAGES = [
  { code: 0x02, name: 'English', index: 1 }, { code: 0x10, name: 'Français', index: 3 },
  { code: 0x04, name: 'Deutsch', index: 0 }, { code: 0x08, name: 'Español', index: 2 },
  { code: 0x20, name: 'Italiano', index: 4 }, { code: 0x01, name: '日本語', index: 5 },
];
export const languageIndex = code => (LANGUAGES.find(l => l.code === code) || LANGUAGES[0]).index;
export const languageCode = index => (LANGUAGES.find(l => l.index === index) || LANGUAGES[0]).code;
const hex = n => n.toString(16).toUpperCase().padStart(2, '0');

// The files of one executable's FILES.PAK, found as its file system finds them:
// the file for all languages, then this language's, then the shared groups.
function pakFiles(fs, dir, language) {
  let name = `${dir}/${hex(language)}_FILES.PAK`;
  if (!fs.has(name)) name = fs.has(`${dir}/FILES.PAK`) ? `${dir}/FILES.PAK` : `${dir}/02_FILES.PAK`;
  if (!fs.has(name)) throw new Error(`This disc has no ${dir}/FILES.PAK — is it Vib-Ribbon?`);
  const pak = readPak(fs.get(name));
  const prefixes = ['', hex(language) + '_', 'FE_', hex(language | 0x03) + '_', hex(language | 0xFB) + '_'];
  const find = file => {
    const slash = file.lastIndexOf('/');
    for (const p of prefixes) {
      const n = file.slice(0, slash + 1) + p + file.slice(slash + 1);
      if (pak.has(n)) return pak.get(n);
    }
    throw new Error(`${file} not found on the disc`);
  };
  const cache = new Map();
  const memo = (kind, fn) => file => {
    const k = kind + file;
    if (!cache.has(k)) cache.set(k, fn(find(file)));
    return cache.get(k);
  };
  return { find, tmd: memo('t', readTmd), anm: memo('a', readAnm), anc: memo('c', readAnc) };
}

export function loadAssets(disc, language = 0x02) {
  const fs = disc.fs;
  const files = pakFiles(fs, 'GAME', language);
  return {
    language,
    languageIndex: languageIndex(language),
    ...files,
    fsl: () => readFsl(files.find('SCRIPT/SYSTEM3.FSL')),
    sounds: () => readVab(fs.get('GAME/AUDIO/PSJ_SE.VH'), fs.get('GAME/AUDIO/PSJ_SE.VB')),
    languages: LANGUAGES.filter(l => fs.has(`GAME/${hex(l.code)}_FILES.PAK`)),
    texts: () => readGameTexts(fs.has('MAIN_G.EXE') ? fs.get('MAIN_G.EXE') : null),
  };
}

// the title executable's files (the intro, the logo, the language and mode menus)
export function loadTitleAssets(disc, language = 0x02) {
  const fs = disc.fs;
  return { language, ...pakFiles(fs, 'TITLE', language), sounds: () => readVab(fs.get('TITLE/AUDIO/TITLE.VH'), fs.get('TITLE/AUDIO/TITLE.VB')) };
}

// the kiosk executable's (the demo scene), if the disc has it
export function loadKioskAssets(disc, language = 0x02) {
  const fs = disc.fs;
  if (!fs.has('KIOSK/AUDIO/KIOSK.VH')) return null;
  try {
    return { language, ...pakFiles(fs, 'KIOSK', language), sounds: () => readVab(fs.get('KIOSK/AUDIO/KIOSK.VH'), fs.get('KIOSK/AUDIO/KIOSK.VB')) };
  } catch { return null; }
}
