# CLI Music Player (XPlayer) — Blessed TUI Edition

A minimal, Spotify-inspired terminal music player built with Node.js and **Blessed**, featuring a dark charcoal and black palette with green accents.

---

## Key Features

- **Clean Split-Pane TUI**: Borderless, clutter-free layout designed around a single source of truth for playback state:
  1. **Playlist (Left)**: Scrollable track list showing clean track names, right-aligned durations (`mm:ss`), an active track indicator (`▸` / `‖`), and live search filtering (`/`).
  2. **Now Playing (Right)**: Compact view with the current track title, progress bar (`━●─`), playback controls, shuffle/repeat states, and volume bar.
  3. **Bottom Hints Bar & `?` Modal**: Displays only essential hints at the bottom; press `?` to open the full keyboard shortcuts overlay.
- **Responsive Layout**: Automatically adapts between side-by-side panes and a stacked vertical layout on narrow terminals.
- **Spotify-Inspired Dark Theme**: Dark charcoal and black backgrounds (`#141414` / `#000000`) with Spotify green accents (`#1DB954` / `#1ED760`). Press `t` to toggle between Charcoal and Midnight dark contrast.
- **Audio Engine**: VLC `rc` controller running in the background with `afinfo` duration detection, seek (`±5s`), volume, mute, Fisher-Yates shuffle, and repeat (`off` / `all` / `one`).

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

## Keyboard Controls

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate playlist tracks |
| `Enter` | Play selected track |
| `Space` | Play / Pause |
| `←` / `→` | Seek backward / forward 5s (`±5s`) |
| `n` / `b` | Next / Previous track |
| `+` / `-` | Volume up / down (5% steps) |
| `m` | Mute / Unmute |
| `s` | Toggle shuffle |
| `r` | Cycle repeat mode (`off` → `all` → `one`) |
| `/` | Search & filter tracks (`Enter` confirms, `Esc` cancels) |
| `Esc` | Clear active search filter / close modal |
| `t` | Toggle Charcoal / Midnight dark contrast |
| `?` | Toggle keyboard shortcuts popup |
| `q` | Quit cleanly (stops VLC and restores terminal) |

---

## Project Structure

| File | Description |
|---|---|
| `player.js` | Minimal Spotify-inspired Blessed TUI music player |
| `songs/` | Audio files directory (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.aac`) |
| `package.json` | Project configuration and dependencies (`blessed`, `commander`) |
| `Phases/` | Historical phase documentation and engineering notes |
| `TermPlayer_Conversation_History.md` | Chronological project development history |
