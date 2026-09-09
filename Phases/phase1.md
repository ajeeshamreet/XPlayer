# Phase 2 — Raw Mode & Arrow-Key Navigation

**Files:** `raw_io.js` (scratchpad) + `lab3.js` (working player)

## What changed from Phase 1

Phase 1 required typing a number and pressing Enter for every action. Phase 2
switches the terminal into **raw mode**, so every individual keypress — including
arrow keys — is delivered to the process immediately as raw bytes, with no line
buffering and no waiting for Enter.

## `raw_io.js` — the exploration file

A minimal scratchpad used to reverse-engineer what bytes the terminal actually
sends for each key:

```js
process.stdin.setRawMode(true)
process.stdin.on('data', (data) => {
    console.log(data.toString(), data)
    if (data[0] === 0x03) process.exit(0)          // Ctrl+C
    if (data[0] === 0x1b && data[1] === 0x5b) {     // ESC [
        if (data[2] === 0x41) console.log('Up Arrow')
        if (data[2] === 0x42) console.log('Down Arrow')
    }
})
```

Key discovery documented here: arrow keys are **3-byte escape sequences**, not single
characters:

| Key | Bytes (hex) |
|---|---|
| Up | `1b 5b 41` |
| Down | `1b 5b 42` |
| Right | `1b 5b 43` |
| Left | `1b 5b 44` |

This is why `data.toString()` alone doesn't work for arrow-key detection — `toString()`
only reliably represents the first byte as a printable character; the escape sequence
needs to be compared byte-by-byte (or via hex/decimal) instead.

## `lab3.js` — the working interactive player

Builds on that discovery to create a real navigable UI:

- **Cursor-based list rendering** — re-prints the song list on every keypress, with
  `>` marking the currently highlighted song (`cursor` index).
- **Arrow-key navigation** — Up/Down move the cursor (not yet wrapped with modulo —
  documented as a known TODO in the code comments).
- **Play on Enter** (`0x0d`) — plays the song at the cursor position via `afplay`.
- **Play/Pause on Spacebar** (`0x20`) — instead of killing the process, it sends
  POSIX signals directly to the child process:
  - `SIGSTOP` → pauses (freezes the process without killing it)
  - `SIGCONT` → resumes
- **Manual Ctrl+C handling** — raw mode suppresses the default `SIGINT` behavior, so
  the code explicitly checks for byte `0x03` and calls `process.exit()`.

## Features at this stage

- ✅ Immediate (no-Enter-needed) keypress handling via raw mode
- ✅ Arrow-key list navigation with live re-render
- ✅ Play / Pause using OS-level process signals (`SIGSTOP` / `SIGCONT`)
- ✅ Manual Ctrl+C exit handling

## Why this phase matters for an interview

This is the most "systems-y" part of the project. It's a strong talking point for:
- Line-buffered vs. raw terminal I/O, and why UIs like `vim`/`less` need raw mode
- Escape-sequence parsing (a simplified version of what libraries like `blessed`,
  `ink`, or `readline` do internally)
- Using Unix signals (`SIGSTOP`/`SIGCONT`) to pause a child process without killing it,
  instead of re-spawning it