# Phase 4 — Final, Bug-Fixed Player

**File:** `player.js`

## What changed from Phase 3

This is the current, most complete version of the player. It keeps everything
from Phase 3 (VLC playback, progress bar, ANSI redraw) and fixes the two bugs
documented there, plus adds more intuitive controls.

## Fixes

1. **Interval leak fixed** — a module-level `elapsedTimer` reference is now kept.
   `startElapsedTracking()` calls `clearInterval(elapsedTimer)` *before* creating a
   new one, so switching tracks no longer stacks duplicate timers:
   ```js
   function startElapsedTracking() {
       if (elapsedTimer !== undefined) {
           clearInterval(elapsedTimer);
       }
       timeElapsed = 0;
       elapsedTimer = setInterval(() => { /* ... */ }, 100);
   }
   ```

2. **Robust duration parsing** — `getSongDuration()` now accumulates *all*
   `stdout` chunks and only parses once the `afinfo` process's `close` event
   fires, with explicit error handling if the exit code is non-zero or the
   expected string isn't found:
   ```js
   afinfoCP.stdout.on("data", (data) => { output += data.toString(); });
   afinfoCP.on("close", (code) => {
       if (code !== 0) { reject(new Error("afinfo could not read this file")); return; }
       const duration = output.split("estimated duration: ")[1];
       if (!duration) { reject(new Error("Could not get duration")); return; }
       resolve(Number(duration.split(".")[0]) + 1);
   });
   ```

## New behavior

- **Left / Right arrow keys now skip tracks directly** (previously they only
  moved the cursor in the list without playing). Right = next + auto-play,
  Left = previous + auto-play — in addition to the existing `n` / `b` keys.
- **Clean terminal restoration on exit** — `process.stdin.setRawMode(false)` is
  called before `process.exit()`, so the shell prompt behaves normally after
  quitting instead of staying in a raw-input state.

## Full feature set (cumulative, current state of the project)

- ✅ Directory-based song discovery (`fs.readdirSync`)
- ✅ Raw-mode, no-Enter-needed keypress handling
- ✅ Arrow-key list navigation with live re-render
- ✅ Track playback via VLC's scriptable `rc` interface
- ✅ Play / Pause (`p` key, via VLC's `pause` command)
- ✅ Next / Previous track — both via `n`/`b` keys **and** `→`/`←` arrows, with
  modulo-wrapped looping
- ✅ Accurate duration lookup via `afinfo`
- ✅ Live elapsed-time tracking (100ms resolution, leak-free)
- ✅ ASCII progress bar with percentage
- ✅ Flicker-free UI redraw via ANSI cursor-positioning escape codes
- ✅ Graceful exit with terminal state restoration (Ctrl+C)

## Current limitations worth naming in an interview

- macOS-only (`afplay`/`afinfo` in earlier phases, VLC CLI still needs to be
  installed and on `PATH`)
- No volume control
- No seeking/scrubbing within a track
- No CLI argument parsing — the song directory and player behavior are hardcoded
- No persistence (playback state, last played song, playlists) across restarts
- Single flat directory only — no subfolders, playlists, or search/filter

These limitations are exactly what `PHASE_5_PLANNED_ENHANCEMENTS.md` addresses.