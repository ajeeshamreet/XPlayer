#!/usr/bin/env node

/**
 * XPlayer - Blessed Terminal Music Player (TUI)
 * Features:
 * - Multi-window Blessed interface with vibrant Orange aesthetic
 * - Dedicated Playlist / Song Browser window with live search filtering
 * - Dedicated Progress Bar & Now Playing window
 * - Dedicated Keyboard Controls & Cheatsheet window
 * - Left/Right arrow keys for -5s / +5s seeking
 * - Up/Down arrow keys for playlist navigation, Enter to play
 * - n / b for Next / Previous track
 * - VLC rc-mode playback engine with volume, pause/play, seek, shuffle, repeat, mute
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const blessed = require('blessed');
const { Command } = require('commander');

// --- CLI Program Definition ---
const program = new Command();

program
  .name('cli-music-player')
  .description('A blessed terminal-based music player with orange theme')
  .version('2.1.0');

program
  .command('play', { isDefault: true })
  .description('Launch the interactive Blessed TUI player')
  .option('-d, --dir <path>', 'directory to load songs from', './songs')
  .option('-s, --shuffle', 'shuffle the playlist on start', false)
  .option('-r, --repeat', 'repeat the playlist when it ends', false)
  .option('-v, --volume <level>', 'starting volume (0-100)', '80')
  .action((options) => {
    startPlayer(options);
  });

// --- Theme Palettes ---
const THEMES = {
  sunset: {
    name: 'Sunset Orange (Default)',
    screenBg: '#D35400',
    cardBg: '#7A2900',
    cardBorder: '#FFA500',
    cardBorderFocus: '#FFFFFF',
    textFg: '#FFFFFF',
    titleFg: '#FFE082',
    accentFg: '#FFD700',
    selectedBg: '#FF7700',
    selectedFg: '#000000',
    barFill: '#FFA500',
    barEmpty: '#4A1800',
    badgePlaying: '#FFD54F',
    badgePaused: '#FFA726',
    dimFg: '#FFCC99'
  },
  vibrant: {
    name: 'Vibrant Orange Pop',
    screenBg: '#E65100',
    cardBg: '#993300',
    cardBorder: '#FFD54F',
    cardBorderFocus: '#FFFFFF',
    textFg: '#FFFFFF',
    titleFg: '#FFF8E1',
    accentFg: '#FFEB3B',
    selectedBg: '#FFA000',
    selectedFg: '#000000',
    barFill: '#FFB300',
    barEmpty: '#5C1D00',
    badgePlaying: '#FFE082',
    badgePaused: '#FFB74D',
    dimFg: '#FFE0B2'
  },
  obsidian: {
    name: 'Obsidian Amber Glow',
    screenBg: '#1A0C02',
    cardBg: '#2E1404',
    cardBorder: '#FF7700',
    cardBorderFocus: '#FFA500',
    textFg: '#FFF3E0',
    titleFg: '#FFA726',
    accentFg: '#FF9800',
    selectedBg: '#E65100',
    selectedFg: '#FFFFFF',
    barFill: '#FF7700',
    barEmpty: '#1F0B00',
    badgePlaying: '#81C784',
    badgePaused: '#FFB74D',
    dimFg: '#BCAAA4'
  }
};

let currentThemeKey = 'sunset';
function getTheme() {
  return THEMES[currentThemeKey];
}

// --- Player State ---
let songDir = '';
let allSongs = [];
let playOrder = [];
let cursor = 0;
let playingIndex = -1; // index in allSongs
let isPaused = true;
let isStopped = true;
let vlcPlayProcess = null;

let totalDuration = 0;
let timeElapsed = 0;
let elapsedTimer = null;

let volume = 80;
let isMuted = false;
let volumeBeforeMute = 80;

let shuffleOn = false;
let repeatMode = 'off'; // 'off' | 'all' | 'one'

let searchMode = false;
let searchQuery = '';
let filteredSongs = []; // Array of { name, originalIndex }

// Blessed UI Elements
let screen = null;
let rootBox = null;
let headerBox = null;
let playlistBox = null;
let playlistWidget = null;
let searchInputBox = null;
let progressBox = null;
let keysBox = null;

// --- Helper Functions ---
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function updatePlayOrder() {
  if (shuffleOn) {
    playOrder = shuffleArray(allSongs.map((_, i) => i));
  } else {
    playOrder = allSongs.map((_, i) => i);
  }
  if (cursor >= playOrder.length) cursor = 0;
}

function updateFilteredSongs() {
  if (!searchQuery) {
    filteredSongs = playOrder.map((origIdx) => ({
      name: allSongs[origIdx],
      originalIndex: origIdx
    }));
  } else {
    const q = searchQuery.toLowerCase();
    filteredSongs = [];
    playOrder.forEach((origIdx) => {
      const name = allSongs[origIdx];
      if (name.toLowerCase().includes(q)) {
        filteredSongs.push({ name, originalIndex: origIdx });
      }
    });
  }
}

async function getSongDuration(songFilePath) {
  return new Promise((resolve) => {
    const afinfoCP = spawn('afinfo', [songFilePath]);
    let output = '';
    afinfoCP.stdout.on('data', (data) => {
      output += data.toString();
    });
    afinfoCP.on('close', (code) => {
      if (code !== 0) {
        resolve(0);
        return;
      }
      const match = output.match(/estimated duration:\s*([0-9.]+)/i);
      if (match && match[1]) {
        resolve(Math.round(parseFloat(match[1])));
      } else {
        resolve(0);
      }
    });
    afinfoCP.on('error', () => {
      resolve(0);
    });
  });
}

function stopCurrentPlayback() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  if (vlcPlayProcess) {
    try {
      vlcPlayProcess.stdin.write('quit\n');
      vlcPlayProcess.kill('SIGTERM');
    } catch (err) {
      // process might already be dead
    }
    vlcPlayProcess = null;
  }
}

function startElapsedTracking() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    if (vlcPlayProcess && !isPaused && !isStopped) {
      timeElapsed += 0.25;
      if (totalDuration > 0 && timeElapsed >= totalDuration + 0.5) {
        handleTrackEnd();
        return;
      }
    }
    renderProgressWindow();
    renderHeader();
  }, 250);
}

async function playTrack(orderIndex) {
  if (filteredSongs.length === 0) return;
  const clampedIdx = Math.max(0, Math.min(orderIndex, filteredSongs.length - 1));
  const trackInfo = filteredSongs[clampedIdx];
  if (!trackInfo) return;

  cursor = clampedIdx;
  playingIndex = trackInfo.originalIndex;
  isPaused = false;
  isStopped = false;

  stopCurrentPlayback();

  const songPath = path.join(songDir, trackInfo.name);
  totalDuration = await getSongDuration(songPath);
  timeElapsed = 0;

  // Launch VLC rc mode headlessly with piped stdio so terminal stays clean
  vlcPlayProcess = spawn('vlc', ['--intf', 'rc', '--no-video', songPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  vlcPlayProcess.on('error', (err) => {
    // Silently handle error
  });

  // Set initial volume
  const vlcVol = isMuted ? 0 : Math.floor((volume / 100) * 256);
  if (vlcPlayProcess.stdin.writable) {
    vlcPlayProcess.stdin.write(`volume ${vlcVol}\n`);
  }

  startElapsedTracking();
  updatePlaylistItems();
  renderProgressWindow();
  renderHeader();
  screen.render();
}

function togglePlayPause() {
  if (isStopped || playingIndex === -1) {
    playTrack(cursor);
    return;
  }
  isPaused = !isPaused;
  if (vlcPlayProcess && vlcPlayProcess.stdin.writable) {
    vlcPlayProcess.stdin.write('pause\n');
  }
  updatePlaylistItems();
  renderProgressWindow();
  renderHeader();
  screen.render();
}

function handleTrackEnd() {
  if (repeatMode === 'one') {
    playTrack(cursor);
  } else if (repeatMode === 'all') {
    const nextIdx = (cursor + 1) % filteredSongs.length;
    playTrack(nextIdx);
  } else {
    // repeat off
    if (cursor < filteredSongs.length - 1) {
      playTrack(cursor + 1);
    } else {
      isPaused = true;
      isStopped = true;
      timeElapsed = totalDuration;
      stopCurrentPlayback();
      updatePlaylistItems();
      renderProgressWindow();
      renderHeader();
      screen.render();
    }
  }
}

function seekPlayback(deltaSeconds) {
  if (!vlcPlayProcess || isStopped) return;
  const newTime = Math.max(0, Math.min(totalDuration, timeElapsed + deltaSeconds));
  timeElapsed = newTime;
  const sign = deltaSeconds > 0 ? `+${deltaSeconds}` : `${deltaSeconds}`;
  if (vlcPlayProcess.stdin.writable) {
    vlcPlayProcess.stdin.write(`seek ${sign}\n`);
  }
  renderProgressWindow();
  screen.render();
}

function nextTrack() {
  if (filteredSongs.length > 0) {
    const nextIdx = (cursor + 1) % filteredSongs.length;
    playTrack(nextIdx);
  }
}

function previousTrack() {
  if (filteredSongs.length > 0) {
    const prevIdx = (cursor - 1 + filteredSongs.length) % filteredSongs.length;
    playTrack(prevIdx);
  }
}

function changeVolume(delta) {
  volume = Math.max(0, Math.min(100, volume + delta));
  isMuted = false;
  if (vlcPlayProcess && vlcPlayProcess.stdin.writable) {
    vlcPlayProcess.stdin.write(`volume ${Math.floor((volume / 100) * 256)}\n`);
  }
  renderProgressWindow();
  renderHeader();
  screen.render();
}

function toggleMute() {
  if (isMuted) {
    volume = volumeBeforeMute;
    isMuted = false;
  } else {
    volumeBeforeMute = volume;
    volume = 0;
    isMuted = true;
  }
  if (vlcPlayProcess && vlcPlayProcess.stdin.writable) {
    const vlcVol = isMuted ? 0 : Math.floor((volume / 100) * 256);
    vlcPlayProcess.stdin.write(`volume ${vlcVol}\n`);
  }
  renderProgressWindow();
  renderHeader();
  screen.render();
}

function toggleShuffle() {
  shuffleOn = !shuffleOn;
  const currentSongName = playingIndex !== -1 ? allSongs[playingIndex] : null;
  updatePlayOrder();
  updateFilteredSongs();

  if (currentSongName) {
    const newIdx = filteredSongs.findIndex((s) => s.name === currentSongName);
    if (newIdx !== -1) cursor = newIdx;
  }
  updatePlaylistItems();
  renderHeader();
  screen.render();
}

function cycleRepeat() {
  if (repeatMode === 'off') repeatMode = 'all';
  else if (repeatMode === 'all') repeatMode = 'one';
  else repeatMode = 'off';
  renderHeader();
  renderProgressWindow();
  screen.render();
}

function cycleTheme() {
  const keys = Object.keys(THEMES);
  const currentIdx = keys.indexOf(currentThemeKey);
  currentThemeKey = keys[(currentIdx + 1) % keys.length];
  applyTheme();
  screen.render();
}

// --- UI Rendering Helpers ---
function renderHeader() {
  const t = getTheme();
  const shuffleBadge = shuffleOn
    ? `{bold}{${t.badgePlaying}-fg}[🔀 SHUFFLE: ON]{/}`
    : `{${t.dimFg}-fg}[🔀 SHUFFLE: OFF]{/}`;
  const repeatBadge =
    repeatMode === 'one'
      ? `{bold}{${t.badgePlaying}-fg}[🔁 REPEAT: ONE]{/}`
      : repeatMode === 'all'
      ? `{bold}{${t.badgePlaying}-fg}[🔁 REPEAT: ALL]{/}`
      : `{${t.dimFg}-fg}[🔁 REPEAT: OFF]{/}`;

  const volBadge = isMuted
    ? `{bold}{red-fg}[🔇 MUTED]{/}`
    : `{${t.titleFg}-fg}[🔊 VOL: ${volume}%]{/}`;

  const themeBadge = `{${t.dimFg}-fg}[🎨 ${t.name}]{/}`;

  headerBox.setContent(
    ` {bold}{${t.titleFg}-fg}🔥 XPLAYER TUI{/}  ${shuffleBadge}  ${repeatBadge}  ${volBadge}  ${themeBadge}`
  );
}

function updatePlaylistItems() {
  const t = getTheme();
  const items = filteredSongs.map((songObj, idx) => {
    const isThisPlaying = songObj.originalIndex === playingIndex && !isStopped;
    const isThisPaused = isThisPlaying && isPaused;

    let icon = '  ';
    if (isThisPlaying) {
      icon = isThisPaused ? '⏸ ' : '▶ ';
    }

    const num = `${(idx + 1).toString().padStart(2, '0')}.`;
    const displayName = songObj.name.replace(/\.[^/.]+$/, ''); // remove extension

    if (isThisPlaying) {
      return `${icon}{bold}${num} ${displayName}{/bold} {${t.accentFg}-fg}${isThisPaused ? '[PAUSED]' : '[PLAYING]'}{/}`;
    }
    return `${icon}${num} ${displayName}`;
  });

  playlistWidget.setItems(items);
  if (filteredSongs.length > 0) {
    playlistWidget.select(cursor);
  }
}

function renderProgressWindow() {
  const t = getTheme();
  const width = Math.max(20, progressBox.width - 6);

  let songTitle = 'No track playing';
  if (playingIndex !== -1 && allSongs[playingIndex]) {
    songTitle = allSongs[playingIndex];
  }

  // Playback badge
  let statusBadge = `{${t.dimFg}-fg}[ ⏹ STOPPED ]{/}`;
  if (!isStopped) {
    statusBadge = isPaused
      ? `{bold}{${t.badgePaused}-fg}[ ⏸ PAUSED ]{/}`
      : `{bold}{${t.badgePlaying}-fg}[ ▶ PLAYING ]{/}`;
  }

  // Progress calculations
  const percent = totalDuration > 0 ? Math.min(100, (timeElapsed / totalDuration) * 100) : 0;
  const elapsedStr = formatTime(timeElapsed);
  const totalStr = formatTime(totalDuration);
  const remainingSec = Math.max(0, totalDuration - timeElapsed);
  const remainingStr = `-${formatTime(remainingSec)}`;

  // Block progress bar
  const barWidth = Math.max(12, width - 20);
  const filledChars = Math.round((barWidth * percent) / 100);
  const emptyChars = Math.max(0, barWidth - filledChars);
  const progressBar = `{${t.barFill}-fg}${'█'.repeat(filledChars)}{/}{${t.barEmpty}-fg}${'░'.repeat(emptyChars)}{/}`;

  // Volume meter
  const volMeterWidth = 16;
  const volFilled = Math.round((volMeterWidth * volume) / 100);
  const volEmpty = Math.max(0, volMeterWidth - volFilled);
  const volBar = isMuted
    ? `{red-fg}[ MUTED ]${'░'.repeat(volMeterWidth - 8)}{/}`
    : `{${t.accentFg}-fg}${'█'.repeat(volFilled)}{/}{${t.barEmpty}-fg}${'░'.repeat(volEmpty)}{/}`;

  const content = [
    '',
    ` {bold}Track:{/bold}   {${t.titleFg}-fg}${songTitle}{/}`,
    ` {bold}State:{/bold}   ${statusBadge}     {bold}Volume:{/bold} [${volBar}] ${volume}%`,
    '',
    ` {bold}Time:{/bold}    ${elapsedStr} / ${totalStr}   (${percent.toFixed(1)}%)   {${t.dimFg}-fg}Remaining: ${remainingStr}{/}`,
    ` {bold}Bar:{/bold}     [${progressBar}]`,
    '',
    ` {${t.dimFg}-fg}Mode: ${repeatMode.toUpperCase()}   |   Shuffle: ${shuffleOn ? 'ON' : 'OFF'}   |   Seek: [← / →] ±5s{/}`
  ].join('\n');

  progressBox.setContent(content);
}

function renderKeysWindow() {
  const t = getTheme();
  const keysContent = [
    '',
    `  {bold}[← / →]{/bold}   Seek -5s / +5s        {bold}[+ / -]{/bold}   Volume Up / Down`,
    `  {bold}[↑ / ↓]{/bold}   Navigate Playlist     {bold}[m]{/bold}       Mute / Unmute`,
    `  {bold}[Enter]  {/bold} Play Highlighted     {bold}[n / b]{/bold}   Next / Prev Track`,
    `  {bold}[p/Space]{/bold} Play / Pause          {bold}[s]{/bold}       Shuffle Toggle`,
    `  {bold}[/]{/bold}       Search Songs          {bold}[r]{/bold}       Repeat Mode`,
    `  {bold}[t]{/bold}       Toggle Orange Theme   {bold}[q / C-c]{/bold} Quit Player`,
    ''
  ].join('\n');

  keysBox.setContent(keysContent);
}

function applyTheme() {
  const t = getTheme();

  rootBox.style.bg = t.screenBg;

  headerBox.style.bg = t.cardBg;
  headerBox.style.border.fg = t.cardBorder;
  headerBox.style.fg = t.textFg;

  playlistBox.style.bg = t.cardBg;
  playlistBox.style.border.fg = t.cardBorder;
  playlistBox.style.fg = t.textFg;

  playlistWidget.style.bg = t.cardBg;
  playlistWidget.style.fg = t.textFg;
  playlistWidget.style.selected.bg = t.selectedBg;
  playlistWidget.style.selected.fg = t.selectedFg;

  progressBox.style.bg = t.cardBg;
  progressBox.style.border.fg = t.cardBorder;
  progressBox.style.fg = t.textFg;

  keysBox.style.bg = t.cardBg;
  keysBox.style.border.fg = t.cardBorder;
  keysBox.style.fg = t.textFg;

  renderHeader();
  updatePlaylistItems();
  renderProgressWindow();
  renderKeysWindow();
}

// --- Player Initialization ---
function startPlayer(options) {
  songDir = path.resolve(options.dir || './songs');
  shuffleOn = Boolean(options.shuffle);
  repeatMode = options.repeat ? 'all' : 'off';
  volume = parseInt(options.volume, 10);
  if (isNaN(volume)) volume = 80;

  if (!fs.existsSync(songDir)) {
    console.error(`Error: Song directory does not exist: ${songDir}`);
    process.exit(1);
  }

  // Read songs (audio files)
  allSongs = fs
    .readdirSync(songDir)
    .filter((file) => !file.startsWith('.') && /\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(file));

  if (allSongs.length === 0) {
    console.error(`No audio files found in ${songDir}`);
    process.exit(1);
  }

  updatePlayOrder();
  updateFilteredSongs();

  // --- Blessed Screen Setup ---
  screen = blessed.screen({
    smartCSR: true,
    title: '⚡ XPlayer - Blessed Terminal Music Player',
    fullUnicode: true,
    mouse: true,
    warning: true
  });

  const t = getTheme();

  // Root background container with orange theme
  rootBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    style: {
      bg: t.screenBg
    }
  });

  // Top Header Box
  headerBox = blessed.box({
    parent: rootBox,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    tags: true,
    style: {
      bg: t.cardBg,
      fg: t.textFg,
      border: { fg: t.cardBorder }
    }
  });

  // Window 1: Playlist Box (Left Column: 48% width)
  playlistBox = blessed.box({
    parent: rootBox,
    top: 3,
    left: 0,
    width: '48%',
    height: '100%-3',
    label: '[ 📂 Tracks & Playlist ]',
    border: { type: 'line' },
    tags: true,
    style: {
      bg: t.cardBg,
      fg: t.textFg,
      border: { fg: t.cardBorder }
    }
  });

  playlistWidget = blessed.list({
    parent: playlistBox,
    top: 0,
    left: 0,
    width: '100%-2',
    height: '100%-4',
    keys: false, // handled manually for precise control
    mouse: true,
    tags: true,
    style: {
      bg: t.cardBg,
      fg: t.textFg,
      selected: {
        bg: t.selectedBg,
        fg: t.selectedFg,
        bold: true
      }
    }
  });

  // Playlist Footer / Search prompt inside playlist box
  const playlistFooter = blessed.box({
    parent: playlistBox,
    bottom: 0,
    left: 0,
    width: '100%-2',
    height: 2,
    tags: true,
    style: {
      bg: t.cardBg,
      fg: t.dimFg
    },
    content: '{bold}[Enter]{/bold} Play  {bold}[/]{/bold} Search  {bold}[↑/↓]{/bold} Move  {bold}[←/→]{/bold} Seek'
  });

  // Window 2: Progress Bar & Now Playing Window (Right Top: 52% height)
  progressBox = blessed.box({
    parent: rootBox,
    top: 3,
    left: '48%',
    width: '52%',
    height: '52%',
    label: '[ ⏱ Now Playing & Progress Bar ]',
    border: { type: 'line' },
    tags: true,
    style: {
      bg: t.cardBg,
      fg: t.textFg,
      border: { fg: t.cardBorder }
    }
  });

  // Window 3: Keyboard Controls & Cheatsheet Window (Right Bottom: remaining 45% height)
  keysBox = blessed.box({
    parent: rootBox,
    top: '55%',
    left: '48%',
    width: '52%',
    height: '45%',
    label: '[ ⌨ Keyboard Controls & Keys ]',
    border: { type: 'line' },
    tags: true,
    style: {
      bg: t.cardBg,
      fg: t.textFg,
      border: { fg: t.cardBorder }
    }
  });

  // Search Input Modal / Bar
  searchInputBox = blessed.textbox({
    parent: rootBox,
    bottom: 1,
    left: '10%',
    width: '80%',
    height: 3,
    hidden: true,
    label: '[ 🔍 Search Songs (Enter to select, Esc to cancel) ]',
    border: { type: 'line' },
    inputOnFocus: true,
    style: {
      bg: '#4A1800',
      fg: '#FFFFFF',
      border: { fg: '#FFD700' }
    }
  });

  // Mouse selection in playlist
  playlistWidget.on('select', (item, index) => {
    playTrack(index);
  });

  // --- Keyboard Event Handling ---
  screen.on('keypress', (ch, key) => {
    if (searchMode) {
      if (key.name === 'escape') {
        exitSearchMode();
        return;
      }
      return;
    }

    // Normal Mode Keybindings
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      cleanupAndExit();
      return;
    }

    // Up / Down: Move selection in playlist
    if (key.name === 'up' || key.name === 'k') {
      if (filteredSongs.length > 0) {
        cursor = (cursor - 1 + filteredSongs.length) % filteredSongs.length;
        playlistWidget.select(cursor);
        screen.render();
      }
      return;
    }

    if (key.name === 'down' || key.name === 'j') {
      if (filteredSongs.length > 0) {
        cursor = (cursor + 1) % filteredSongs.length;
        playlistWidget.select(cursor);
        screen.render();
      }
      return;
    }

    // Enter: Play currently selected song
    if (key.name === 'return' || key.name === 'enter') {
      playTrack(cursor);
      return;
    }

    // Space / p: Play/Pause toggle
    if (key.name === 'space' || key.name === 'p') {
      togglePlayPause();
      return;
    }

    // Left / Right Arrow Keys: SEEK -5s / +5s
    if (key.name === 'right' || ch === '>' || ch === '.') {
      seekPlayback(5);
      return;
    }

    if (key.name === 'left' || ch === '<' || ch === ',') {
      seekPlayback(-5);
      return;
    }

    // n: Next track, b: Previous track
    if (ch === 'n' || ch === ']') {
      nextTrack();
      return;
    }

    if (ch === 'b' || ch === '[') {
      previousTrack();
      return;
    }

    // Volume controls
    if (ch === '+' || ch === '=') {
      changeVolume(5);
      return;
    }

    if (ch === '-' || ch === '_') {
      changeVolume(-5);
      return;
    }

    // Mute toggle
    if (ch === 'm') {
      toggleMute();
      return;
    }

    // Shuffle toggle
    if (ch === 's') {
      toggleShuffle();
      return;
    }

    // Repeat cycle
    if (ch === 'r') {
      cycleRepeat();
      return;
    }

    // Theme toggle
    if (ch === 't') {
      cycleTheme();
      return;
    }

    // Search mode
    if (ch === '/') {
      enterSearchMode();
      return;
    }
  });

  function enterSearchMode() {
    searchMode = true;
    searchInputBox.setValue('');
    searchInputBox.show();
    searchInputBox.focus();
    screen.render();

    searchInputBox.readInput((err, value) => {
      if (err || value === undefined) {
        exitSearchMode();
        return;
      }
      searchQuery = (value || '').trim();
      updateFilteredSongs();
      cursor = 0;
      updatePlaylistItems();
      exitSearchMode();
      if (filteredSongs.length > 0) {
        playTrack(0);
      }
    });
  }

  function exitSearchMode() {
    searchMode = false;
    searchInputBox.hide();
    screen.render();
  }

  function cleanupAndExit() {
    stopCurrentPlayback();
    if (elapsedTimer) clearInterval(elapsedTimer);
    screen.destroy();
    process.exit(0);
  }

  // Handle process termination signals
  process.on('SIGINT', cleanupAndExit);
  process.on('SIGTERM', cleanupAndExit);
  process.on('exit', () => {
    stopCurrentPlayback();
  });

  // Handle terminal resizing
  screen.on('resize', () => {
    renderHeader();
    updatePlaylistItems();
    renderProgressWindow();
    renderKeysWindow();
    screen.render();
  });

  // Initial render
  applyTheme();
  screen.render();

  // Auto-play first song
  playTrack(0);
}

program.parse(process.argv);