# Phase 5 — Planned Enhancements (Interview Showcase)

This phase is **not implemented yet** — it's the proposed next step, designed to
turn a working lab project into something with real "I made deliberate
engineering decisions" talking points for an interview.

Three core additions, one cleanup pass to remove redundant bindings, and two
optional stretch features.

---

## 0. Clean up — remove redundant keybindings

**Problem:** Phase 4 bound the *same* action (next / previous track) to **two**
separate keys each: `→` **and** `n` both go to the next track; `←` **and** `b`
both go to the previous track. That's dead weight — it doesn't add capability,
it just adds two more `if` branches and two more keys that do nothing new.

**Change:** drop `n` and `b` entirely. Keep `→` / `←` as the single, discoverable
binding for next/previous (arrow keys are the more intuitive default for a
list-navigation UI anyway).

```diff
- if (data[0] === 110) { // 'n' - next
-     cursor = (cursor + 1) % allSongs.length;
-     listSongs(songDir);
-     playSong(cursor);
- }
- if (data[0] === 98) { // 'b' - previous
-     cursor = ((cursor - 1) % allSongs.length + allSongs.length) % allSongs.length;
-     listSongs(songDir);
-     playSong(cursor);
- }
```

This frees up `n` and `b` (and removes ~10 lines of duplicate logic), which are
then reassigned to real, new functionality below instead of duplicating what
the arrow keys already do.

**Interview talking point:** recognizing and removing redundant control paths is
as much a signal of engineering maturity as adding new features — fewer code
paths doing the same thing means less to test and fewer places for the UI state
to drift out of sync.

---

## 1. A proper CLI powered by `commander.js`

**Problem it solves:** right now every setting (song directory, starting
behavior) is hardcoded. There's no `--help`, no `--version`, and no way to pass
options without editing the source.

**Plan:**

```js
#!/usr/bin/env node
const { Command } = require('commander');
const program = new Command();

program
  .name('cli-music-player')
  .description('A terminal-based music player')
  .version('1.0.0');

program
  .command('play', { isDefault: true })
  .description('Launch the interactive player')
  .option('-d, --dir <path>', 'directory to load songs from', './songs')
  .option('-s, --shuffle', 'shuffle the playlist on start', false)
  .option('-r, --repeat', 'repeat the playlist when it ends', false)
  .option('-v, --volume <level>', 'starting volume (0-100)', '80')
  .action((options) => {
      startPlayer(options); // wraps the existing raw-mode loop from Phase 4
  });

program.parse();
```

Run as: `node index.js play --dir ./my-songs --shuffle --volume 60`

**Interview talking point:** why a real argument-parsing library beats hand-rolled
`process.argv` parsing — automatic `--help` generation, type coercion, subcommands,
and clear option validation for free.

---

## 2. Volume control — `+` / `-` keys

**Problem it solves:** the player currently has no way to adjust loudness; it's
whatever VLC starts at.

**Plan:**
- Track a `volume` state variable (0–100), seeded from the `--volume` CLI flag.
- On `+` (byte `0x2b`): increment volume, clamp at 100, send to VLC's `rc`
  interface: `vlcPlayProcess.stdin.write('volup 5\n')` (or the absolute form
  `volume <n>\n`, VLC's `rc` protocol supports both).
- On `-` (byte `0x2d`): decrement, clamp at 0, `voldown 5\n`.
- Render the current level next to the progress bar, e.g. `Vol: [███░░░░░░░] 60%`.

```js
if (data[0] === 0x2b) { // '+'
    volume = Math.min(100, volume + 5);
    vlcPlayProcess?.stdin.write('volup 1\n');
    listSongs(songDir);
}
if (data[0] === 0x2d) { // '-'
    volume = Math.max(0, volume - 5);
    vlcPlayProcess?.stdin.write('voldown 1\n');
    listSongs(songDir);
}
```

**Interview talking point:** two-way communication with a child process over
`stdin` (write) vs. `stdout` (read) — same pattern already used for `pause`,
extended here for a new command.

---

## 3. Seek / scrub within a track — `<` / `>` keys (5s steps)

**Problem it solves:** the player can only skip to a *different* track
(`←`/`→`), never jump forward or backward *within* the current one.

**Why `<` / `>` instead of the arrow keys:** `←`/`→` are already bound to
previous/next track (Phase 4). Reusing them for seeking would collide with that
behavior, so this deliberately uses distinct physical keys — a small but real UX
decision worth explaining out loud in an interview.

**Plan:**
- On `>` (byte `0x3e`): seek forward **5 seconds** — send `seek +5s\n` to VLC's
  `rc` interface, and immediately bump the local `timeElapsed` by 5 so the
  progress bar doesn't wait for the next poll tick to catch up.
- On `<` (byte `0x3c`): seek backward **5 seconds** — `seek -5s\n`, decrement
  `timeElapsed` by 5 (clamped at 0).

```js
const SEEK_STEP_SECONDS = 5;

if (data[0] === 0x3e) { // '>'
    vlcPlayProcess?.stdin.write(`seek +${SEEK_STEP_SECONDS}s\n`);
    timeElapsed = Math.min(totalDuration, timeElapsed + SEEK_STEP_SECONDS);
    listSongs(songDir);
}
if (data[0] === 0x3c) { // '<'
    vlcPlayProcess?.stdin.write(`seek -${SEEK_STEP_SECONDS}s\n`);
    timeElapsed = Math.max(0, timeElapsed - SEEK_STEP_SECONDS);
    listSongs(songDir);
}
```

5 seconds (vs. the more common 10s) was chosen deliberately for finer-grained
scrubbing — worth mentioning as a conscious UX tuning choice, not an arbitrary
number.

**Interview talking point:** the local `timeElapsed` counter is an
*optimistic UI update* — the UI updates instantly instead of waiting on VLC's
own state to round-trip, a pattern that shows up constantly in real frontend/UI
engineering (optimistic updates, then reconcile with the source of truth).

---

## 4. Shuffle toggle — `s` key (reuses the freed `n`/`b` slots' key-space)

**Problem it solves:** playlist order is always the raw `fs.readdirSync` order —
there's no randomization.

**Plan:**
- Track a `shuffleOn` boolean and a `playOrder` array of indices.
- On `s`: toggle `shuffleOn`. If turning on, build `playOrder` via a
  Fisher–Yates shuffle of `[0..allSongs.length-1]`; if turning off, reset it to
  sequential order. `→`/`←` (next/previous) then walk `playOrder` instead of
  the raw index directly.
- Show the current mode in the UI header, e.g. `[Shuffle: ON]`.

**Interview talking point:** Fisher–Yates is a classic, easy-to-explain
algorithm — good for a quick "why not `Array.sort(() => Math.random() - 0.5)`"
discussion (that approach is a biased shuffle; Fisher–Yates isn't).

---

## 5. Repeat mode — `r` key (cycles: off → repeat-all → repeat-one)

**Problem it solves:** when the playlist ends, playback just stops.

**Plan:**
- Track a `repeatMode` enum: `'off' | 'all' | 'one'`.
- On `r`: cycle through the three states.
- When a track finishes (VLC's `rc` interface emits a status change / the
  process exits), decide what happens next based on `repeatMode`:
  - `'one'` → replay the same track
  - `'all'` → advance to the next track, wrapping to index 0 at the end
  - `'off'` → advance normally, stop after the last track
- Show current mode in the UI header, e.g. `[Repeat: ALL]`.

---

## 6. Mute toggle — `m` key

**Problem it solves:** quick mute/unmute without losing the previous volume
level (as opposed to spamming `-` down to 0).

**Plan:**
- Store `volumeBeforeMute` when muting; on `m`, send `volume 0\n` to VLC and
  flip a `isMuted` flag. On un-mute, restore `volume <volumeBeforeMute>\n`.

---

## 7. Song search / filter — `/` key

**Problem it solves:** with more than a handful of songs, scrolling through the
full list to find one is slow.

**Plan:**
- On `/`: drop into a small line-input mode (temporarily disable raw mode or
  buffer typed characters) to filter `allSongs` by substring match, live-updating
  the rendered list as the user types. `Enter` confirms and plays the top match;
  `Esc` cancels and restores the full list.

---

## Updated keybinding table (Phase 5 target state)

| Key | Action |
|---|---|
| `↑` / `↓` | Move cursor through song list |
| `←` / `→` | Previous / Next track *(single binding — `n`/`b` removed as redundant)* |
| `Enter` | Play highlighted song |
| `p` | Play / Pause |
| `+` / `-` | Volume up / down |
| `>` / `<` | Seek forward / backward **5s** within current track |
| `s` | Toggle shuffle |
| `r` | Cycle repeat mode (off → all → one) |
| `m` | Mute / unmute |
| `/` | Search / filter songs by name |
| `Ctrl+C` | Exit (with terminal state restored) |

Every key now maps to exactly one distinct action — no two keys do the same
thing, and no key is wasted on a duplicate of the arrow keys.

## Suggested "pick 2–3" for a live interview demo

If time is limited, the strongest combination to actually build and demo is:
**Commander.js CLI (#1) + Volume control (#2) + Seek control (#3)**, plus the
redundant-key cleanup (#0) as a quick "here's a bug/smell I noticed and fixed"
talking point. Add shuffle (#4) as a fourth if there's extra time — it's the
most visually demonstrable of the remaining features.