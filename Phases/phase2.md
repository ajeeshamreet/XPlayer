# Phase 3 — VLC Integration & Live Progress Bar

**File:** `lab5.js`

## What changed from Phase 2

`afplay` can be started, killed, `SIGSTOP`-ed and `SIGCONT`-ed, but it has no
scriptable command protocol and no way to report time position. This phase
switches the playback engine to **VLC's remote-control interface**, which unlocks
real playback control and lays the groundwork for a progress bar.

## Core mechanics

- **VLC RC interface**: songs are played via
  `spawn('vlc', ['--intf', 'rc', songFinalPath])`. The `rc` (remote control)
  interface lets the Node process send text commands to VLC over its `stdin`
  (e.g. `pause\n`), instead of only sending OS signals.
- **Duration lookup**: `getSongDuration()` spawns `afinfo <file>`, reads the
  `estimated duration:` line from its output, and parses it into whole seconds.
- **Elapsed-time tracking**: `startElapsedTracking()` runs a `setInterval` every
  100ms, incrementing a `timeElapsed` counter by `0.1` whenever a song is playing
  and not paused.
- **ASCII progress bar**: `renderBar()` converts a percentage into a 50-character
  bar of `X` (played) and `.` (remaining):
  ```
  XXXXXXXXXXXXXXXXXXXX..............................
  ```
- **Flicker-free redraw**: instead of clearing the whole screen, it uses raw ANSI
  escape codes:
  - `\x1B[2;1H` — move cursor to row 2, column 1
  - `\x1B[0K` — clear from cursor to end of line
  This lets the song list + progress bar update in place every 100ms without
  visible flicker.
- **Next/Previous shortcuts**: `n` (next) / `b` (back) keys, with the cursor
  wrapped using the modulo operator so it loops from the last song back to the
  first (and vice versa) — this is the fix for the "TODO: use modulo" note left
  in Phase 2's `lab3.js`.

## Features at this stage

- ✅ Real playback engine control via VLC's `rc` protocol (not just signals)
- ✅ Accurate track duration via `afinfo`
- ✅ Live elapsed-time counter (100ms resolution)
- ✅ Visual ASCII progress bar
- ✅ Smooth, flicker-free terminal redraw using ANSI escape codes
- ✅ Looping next/previous navigation (modulo-wrapped)

## Known bugs at this stage (fixed in Phase 4)

- ⚠️ **Interval leak**: `startElapsedTracking()` is called every time a new song
  starts, but the previous `setInterval` is never cleared — switching songs
  repeatedly stacks up multiple concurrent timers, each redrawing the UI and
  incrementing `timeElapsed` independently.
- ⚠️ **Fragile duration parsing**: `getSongDuration()` resolves on the *first*
  `data` event from `afinfo`'s `stdout`, which isn't guaranteed to contain the
  full output — large or slow output can be split across multiple chunks.

## Why this phase matters for an interview

Great phase to discuss **process orchestration between two runtimes** (Node ↔
VLC) using a text-based stdin protocol, why polling via `setInterval` was chosen
over waiting on VLC's own status events, and how ANSI escape codes are the
building block behind every terminal UI library (ncurses, blessed, ink, etc.).
It's also a good candid moment to walk through the two bugs above and how you'd
debug them (e.g., "I noticed songs kept re-triggering redraws faster after every
skip — traced it to an uncleared interval").