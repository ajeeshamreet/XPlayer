# CLI Music Player — Documentation Index

This project is a terminal-based music player built in Node.js, evolving through
several implementation phases — from a basic numbered-selection player to a
raw-mode, arrow-key-driven player with a live progress bar.

## Files in this project

| File | Role |
|---|---|
| `cli_player.js` | Phase 1 — basic numeric song selection |
| `raw_io.js` | Phase 2a — raw-mode keypress exploration/scratchpad |
| `lab3.js` | Phase 2b — arrow-key navigation + pause/resume |
| `lab5.js` | Phase 3 — VLC integration + live progress bar |
| `player.js` | Phase 4 — final, bug-fixed version |

## Phase documents

1. [`PHASE_1_BASIC_CLI_PLAYER.md`](./PHASE_1_BASIC_CLI_PLAYER.md) — `cli_player.js`
2. [`PHASE_2_RAW_MODE_AND_NAVIGATION.md`](./PHASE_2_RAW_MODE_AND_NAVIGATION.md) — `raw_io.js` + `lab3.js`
3. [`PHASE_3_VLC_INTEGRATION_PROGRESS_BAR.md`](./PHASE_3_VLC_INTEGRATION_PROGRESS_BAR.md) — `lab5.js`
4. [`PHASE_4_FINAL_POLISHED_PLAYER.md`](./PHASE_4_FINAL_POLISHED_PLAYER.md) — `player.js`
5. [`PHASE_5_PLANNED_ENHANCEMENTS.md`](./PHASE_5_PLANNED_ENHANCEMENTS.md) — Commander.js CLI, volume (`+`/`-`) and seek (`<`/`>`) controls, and other interview-ready upgrades

## Current keybindings (as of Phase 4)

| Key | Action |
|---|---|
| `↑` / `↓` | Move cursor through song list |
| `←` | Previous track (skip + auto-play) |
| `→` | Next track (skip + auto-play) |
| `n` | Next track (alt binding) |
| `b` | Previous track (alt binding) |
| `Enter` | Play the highlighted song |
| `p` | Play / Pause |
| `Ctrl+C` | Exit |

## Planned keybindings (Phase 5)

`n` / `b` are **removed** — they duplicated `←`/`→` (next/previous). Those keys
are freed up for new, non-overlapping features:

| Key | Action |
|---|---|
| `+` | Volume up |
| `-` | Volume down |
| `>` | Seek forward 5s (scrub within current track) |
| `<` | Seek backward 5s (scrub within current track) |
| `s` | Toggle shuffle |
| `r` | Cycle repeat mode (off → all → one) |
| `m` | Mute / unmute |
| `/` | Search / filter songs by name |

See `PHASE_5_PLANNED_ENHANCEMENTS.md` for full design and rationale.