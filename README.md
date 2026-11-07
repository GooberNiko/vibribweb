# Vib-Ribbon Web

A from-scratch web reimplementation of Vib-Ribbon (PlayStation, 1999) that runs on **your own disc image**.
No emulator, and no game data in this repository: models, animations, cameras, the level script,
sound effects and music are all read at runtime from the disc the player drops in.

## Run

ES modules need a web server (opening `index.html` from disk won't work):

```sh
python -m http.server 8000
# then open http://localhost:8000
```

Any static host works too (GitHub Pages, Netlify, …).

## Play

Drop your disc image on the page: a `.zip` holding the `.cue` and every `.bin`, or the files
themselves. All 8 tracks are needed. Track 1 holds the game data and tracks 2–8 hold the music.

| Road  | Keys          | Pad             |
|-------|---------------|-----------------|
| Block | `←` / `A`     | L1 / L2         |
| Pit   | `↓` / `S`     | D-pad up / down |
| Loop  | `→` / `D`     | R1 / R2         |
| Wave  | `↑` / `W` / Space | ✕ / △       |

Press two roads together for a double obstacle. `Esc` or Start pauses.

The game starts as the disc does: the title movie (`Enter` skips it), the language menu the
first time, then the mode menu. The menus, the results of a course (cleared or game over), the
high scores and "try again?" are the game's own screens, drawn from the disc. Their texts are
read from the disc's `MAIN_G.EXE` (PAL release). Left alone on the title, it plays its demos.

Widescreen (16:9, on by default) shows more to the left and right; turn it off under *settings*.

The menus are driven like the original's. Use `↑` `↓` (and `←` `→` on the track
select), `Enter` / ✕ to choose, and `Esc` / ○ to go back. A click picks the item under the cursor
and the mouse wheel moves it.

**Play with my own choice of CD** works like the original's CD swap. Choose *Change the CD*, drop any
audio files, and the ribbon is built from the sound itself. One track, all tracks, the three speed
courses and the self-playing mode are all there.

## Level editor

*level editor* (under the menus) opens your levels. Start one from a disc track or a song file,
either **from the music** (the obstacles the game itself would make, to edit) or **blank**.

- **Timeline:** the waveform and a beat grid (BPM, offset, snap), with lanes for obstacles, the
  game's camera shots (behind, side, front; loops; left or right), breaks, twists of the road and
  free camera keyframes. Click to select (Shift adds, drag a box in a lane), drag to move,
  double-click to add, Del to delete, Ctrl+Z / Ctrl+Y, Ctrl+C / Ctrl+V at the playhead, `[` `]` nudge.
- **Speed:** the Speed lane is a graph of how fast the road comes. Double-click it to add a change
  at the height clicked, drag a change sideways or up and down, and make it a *jump* or a *ramp*
  (reached gradually). An obstacle can also have its own speed.
- **Tempo:** set the BPM by typing it, tapping `T` on the beat, or *From the obstacles*.
- **Tapping:** press Space to play and tap `←` `↓` `→` `↑` (or `A` `S` `D` `W`) on the beat; two at
  once make a double.
- **Free camera:** `K` drops a keyframe at the playhead from the current view. With one picked,
  drag the preview to orbit, Shift+drag to pan, wheel to move in, Alt+wheel to zoom. Keys ease
  into the next (smooth, linear or cut); "the game's camera" hands back to the shots.
- **Play level / Play from here** play it as a course and come back to the editor.

Levels save in the browser as you go. *Export* writes a small `.vibl` file to share: it names
the song (a disc track number, or your file's name and length), never includes it.

## How it works

| File | What it does |
|------|--------------|
| `js/disc.js` | zip → cue/bin → ISO 9660; CD audio tracks |
| `js/formats.js` | the game's formats: FILES.PAK, TMD line models, ANM/ANC movies, SYSTEM3.FSL, VAB sounds (PS-ADPCM) |
| `js/analysis.js` | the level script plus onset detection: obstacles go where the music gets louder |
| `js/gameplay.js` | timing windows, scoring, Vibri's forms, the scene |
| `js/camera.js` | the camera sequences and transitions |
| `js/scene.js` | the title executable: the intro movie, the logo, the language and mode menus, the demo scene |
| `js/level.js` | levels: the `.vibl` format, the level as the game's events, the free camera, making one from the music |
| `js/editor.js` | the level editor: timeline, inspector, preview, tapping, flying the camera |
| `js/title.js` | the game's menus, results and high scores: cursor movies, camera swings, Vibri's poses and lines, the score said aloud |
| `js/render.js` | PlayStation-style look-at projection and jittered vector lines on a canvas |

Format and behaviour references: the [open-ribbon](https://open-ribbon.github.io/documentation)
documentation and the [revib](https://github.com/pawix25/revib) decompilation.

Tested with the PAL release (SCES-02873). Vib-Ribbon © Sony Interactive Entertainment / NanaOn-Sha.
This is an unofficial fan project.
