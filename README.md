# CLI Music Player (XPlayer) — Blessed TUI Edition

A rich, interactive terminal music player built with Node.js and **Blessed**, featuring an energetic **Orange** aesthetic and a multi-window TUI layout.

---

## Key Features

- **Multi-Window Blessed TUI**: Cleanly partitioned interface with dedicated windows:
  1. **📂 Tracks & Playlist Window**: Browse, scroll, and highlight tracks with status icons (`▶` Playing, `⏸` Paused). Includes interactive live search (`/`).
  2. **⏱ Now Playing & Progress Window**: Displays the active track title, elapsed and total duration, high-resolution block progress bar (`[████░░░]`), volume gauge, and playback status badges.
  3. **⌨ Keyboard Controls (Keys) Window**: Quick reference cheatsheet showing all keyboard shortcuts.
- **Seek Scrubbing with Arrow Keys**: Left (`←`) and Right (`→`) arrow keys seek **-5s** and **+5s** instantly within the track!
- **Orange Aesthetics**: Designed with a warm orange theme (`#D35400` / `#FFA500` / `#FFE082`). Includes instant theme toggling via `t` (Sunset Orange, Vibrant Orange Pop, and Obsidian Amber Glow).
- **Audio Engine**: VLC `rc` controller running cleanly in the background with `afinfo` duration detection, volume control, mute, seek, shuffle (Fisher-Yates), and repeat modes (`off`/`all`/`one`).

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Launch Player
```bash
# Launch with default settings
npm start
# or
node player.js

# Custom song folder, shuffle, or initial volume
node player.js play --dir ./songs --shuffle --volume 75
```

---

## Keyboard Controls (Keys Cheatsheet)

| Key | Action |
|---|---|
| `←` / `→` | Seek backward / forward 5s (`±5 sec`) |
| `↑` / `↓` (`k` / `j`) | Navigate playlist tracks |
| `Enter` | Play highlighted track |
| `p` or `Space` | Play / Pause |
| `n` / `b` (`]` / `[`) | Next / Previous track |
| `+` / `-` | Volume Up / Down (5% steps) |
| `m` | Mute / Unmute toggle |
| `s` | Toggle Shuffle (Fisher-Yates randomization) |
| `r` | Cycle Repeat mode (`off` → `all` → `one`) |
| `/` | Open Search & Filter bar (`Enter` confirms, `Esc` cancels) |
| `t` | Toggle Orange color theme |
| `q` or `Ctrl+C` | Clean exit (kills VLC and restores terminal screen) |

---

## Project Structure

| File | Description |
|---|---|
| `player.js` | Blessed TUI music player with Orange theme |
| `songs/` | Audio files directory (`.mp3`, `.wav`, `.m4a`, etc.) |
| `package.json` | Project configuration and dependencies (`blessed`, `commander`) |
| `Phases/` | Historical phase documentation and engineering notes |