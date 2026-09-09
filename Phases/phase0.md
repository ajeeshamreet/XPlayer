# Phase 1 — Basic CLI Player

**File:** `cli_player.js`

## What it does

The simplest version of the player. It lists every file in the `songs/`
directory with a numeric index, waits for the user to type a number and
press **Enter**, then plays that file.

```
0 take_on_me.mp3
1 good_carl.mp3
2 carl_vue_hmong.mp3
Select a song:
```

## Core mechanics

- **Listing songs**: shells out to the `ls` command via `child_process.spawn('ls', [SONG_DIR])`
  and parses `stdout` into an array of filenames.
- **Selection**: reads normal (line-buffered) `stdin` input — the user must type a
  digit and hit Enter, since raw mode is **not** enabled here.
- **Playback**: spawns `afplay <path>` (macOS-only utility) as a detached child process
  and lets it run independently — the Node process doesn't track or control it further.
- **Validation**: if the typed index doesn't exist in the `songs` array, prints
  `Invalid selection` instead of crashing.

## Features at this stage

- ✅ Directory-based song discovery
- ✅ Numbered song list
- ✅ Play-by-index selection
- ✅ Basic invalid-input handling

## Limitations (by design — this is the MVP)

- No pause / resume / stop
- No visual "now playing" indicator
- Requires typing + Enter for every action (no live keypress response)
- macOS-only (`afplay`)
- Multiple songs can be triggered to play simultaneously (no cleanup of the
  previous `afplay` process before starting a new one)

## Why this phase matters for an interview

This is the "walking skeleton" — it proves out the core loop (list → select → spawn a
player process) before adding complexity like raw terminal I/O. It's a good place to
talk about `child_process.spawn`, why `exec` wasn't used (no shell string interpolation
risk), and why streaming `stdout` is preferred over blocking reads.