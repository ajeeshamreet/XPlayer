#!/usr/bin/env node

/**
 * XPlayer - Minimal Spotify-Inspired Blessed Terminal Music Player
 * Features:
 * - Dark charcoal & black palette with Spotify green accents
 * - Left playlist pane displaying track names and durations
 * - Right compact Now Playing pane with progress bar, playback controls, modes & volume
 * - Minimal bottom hints bar with '?' overlay for full keyboard shortcuts
 * - Responsive side-by-side or stacked layout for any terminal size
 * - Preserved VLC rc-mode playback engine, afinfo duration lookup, search, shuffle, repeat
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
  .description('A minimal Spotify-inspired blessed terminal music player')
  .version('2.2.0');

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

// --- Theme Palettes (Verified xterm-256 safe hexes) ---
const THEMES = {
  charcoal: {
    name: 'Spotify Charcoal',
    screenBg: '#000000',
    panelBg: '#141414',
    barBg: '#181818',
    selectedBg: '#282828',
    barEmpty: '#333333',
    borderFg: '#174D2E',
    dividerFg: '#282828',
    dimFg: '#888888',
    mutedFg: '#B3B3B3',
    textFg: '#F8F8F8',
    green: '#1DB954',
    greenBright: '#1ED760',
    dangerFg: '#E53935'
  },
  midnight: {
    name: 'Spotify Midnight',
    screenBg: '#000000',
    panelBg: '#000000',
    barBg: '#141414',
    selectedBg: '#282828',
    barEmpty: '#333333',
    borderFg: '#174D2E',
    dividerFg: '#282828',
    dimFg: '#888888',
    mutedFg: '#B3B3B3',
    textFg: '#F8F8F8',
    green: '#1DB954',
    greenBright: '#1ED760',
    dangerFg: '#E53935'
  }
};

let currentThemeKey = 'charcoal';
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
let playRequestId = 0;
let isExiting = false;

let totalDuration = 0;
let timeElapsed = 0;
let elapsedTimer = null;
const songDurations = new Map();

let volume = 80;
let isMuted = false;
let volumeBeforeMute = 80;

let shuffleOn = false;
let repeatMode = 'off'; // 'off' | 'all' | 'one'

let searchMode = false;
let searchQuery = '';
let filteredSongs = []; // Array of { name, originalIndex }
let helpModalOpen = false;
let isUpdatingList = false;

// Blessed UI Elements
let screen = null;
let rootBox = null;
let playlistPanel = null;
let playlistHeader = null;
let playlistWidget = null;
let emptyPlaylistBox = null;
let nowPlayingPanel = null;
let nowPlayingContent = null;
let bottomBar = null;
let searchInputBox = null;
let helpModal = null;

// --- Pure Formatting & Layout Helpers ---
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function stripExtension(filename) {
  return String(filename || '').replace(/\.[^/.]+$/, '');
}

function truncateText(text, maxLen) {
  if (maxLen <= 0) return '';
  const str = String(text || '');
  if (str.length <= maxLen) return str;
  if (maxLen === 1) return '…';
  return `${str.slice(0, maxLen - 1)}…`;
}

function wrapTextLines(text, maxLen, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  if (maxLen <= 2) return [truncateText(text, maxLen)];

  const lines = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else if (!current) {
      lines.push(truncateText(word, maxLen));
      if (lines.length >= maxLines) return lines;
    } else {
      lines.push(current);
      if (lines.length >= maxLines) {
        lines[lines.length - 1] = truncateText(
          `${lines[lines.length - 1]} ${words.slice(i).join(' ')}`,
          maxLen
        );
        return lines;
      }
      current = word;
    }
  }
  if (current) {
    lines.push(truncateText(current, maxLen));
  }
  return lines.slice(0, maxLines);
}

/**
 * Computes responsive panel rectangles for side-by-side (>=68 cols) or stacked (<68 cols) terminals.
 */
function computeLayout(screenWidth, screenHeight) {
  const w = Math.max(24, screenWidth || 80);
  const h = Math.max(10, screenHeight || 24);

  const topMargin = h >= 18 ? 1 : 0;
  const bottomHeight = 1;
  const bottomGap = h >= 14 ? 1 : 0;
  const mainHeight = Math.max(5, h - topMargin - bottomHeight - bottomGap);
  const isStacked = w < 68;

  if (!isStacked) {
    const splitRatio = w >= 100 ? 0.54 : 0.50;
    const leftWidth = Math.max(24, Math.floor((w - 1) * splitRatio));
    const rightLeft = leftWidth + 1;
    const rightWidth = Math.max(20, w - rightLeft);

    return {
      isStacked: false,
      width: w,
      height: h,
      playlist: { top: topMargin, left: 0, width: leftWidth, height: mainHeight },
      nowPlaying: { top: topMargin, left: rightLeft, width: rightWidth, height: mainHeight },
      bottom: { top: h - 1, left: 0, width: w, height: bottomHeight }
    };
  }

  const npHeight = h >= 22 ? 8 : (h >= 16 ? 7 : (h >= 12 ? 6 : 5));
  const gapY = h >= 15 ? 1 : 0;
  const playlistHeight = Math.max(4, mainHeight - npHeight - gapY);
  const npTop = topMargin + playlistHeight + gapY;

  return {
    isStacked: true,
    width: w,
    height: h,
    playlist: { top: topMargin, left: 0, width: w, height: playlistHeight },
    nowPlaying: { top: npTop, left: 0, width: w, height: Math.max(4, topMargin + mainHeight - npTop) },
    bottom: { top: h - 1, left: 0, width: w, height: bottomHeight }
  };
}

function buildProgressBarString(elapsed, total, barWidth, theme, paused) {
  const w = Math.max(4, barWidth);
  if (total <= 0) {
    return `{${theme.barEmpty}-fg}${'─'.repeat(w)}{/}`;
  }
  const ratio = Math.min(1, Math.max(0, elapsed / total));
  const thumbPos = Math.min(w - 1, Math.max(0, Math.round(ratio * (w - 1))));
  const leftChars = thumbPos;
  const rightChars = Math.max(0, w - thumbPos - 1);
  const thumbColor = paused ? theme.mutedFg : theme.textFg;

  return (
    `{${theme.green}-fg}${'━'.repeat(leftChars)}{/}` +
    `{${thumbColor}-fg}●{/}` +
    `{${theme.barEmpty}-fg}${'─'.repeat(rightChars)}{/}`
  );
}

function buildBottomHintsLine(maxWidth, theme, hasSearchFilter) {
  // Order for rendering left-to-right; drop middle optional items first if narrow
  const displayOrder = [
    ['Space', 'Play/Pause'],
    ['←/→', 'Seek'],
    ['/', 'Search'],
    ...(hasSearchFilter ? [['Esc', 'Clear']] : []),
    ['?', 'Shortcuts'],
    ['q', 'Quit']
  ];
  const dropPriority = ['←/→', '/', 'Esc', '?', 'Space', 'q'];

  let active = displayOrder.slice();
  const sep = maxWidth >= 60 ? '   ' : '  ';
  const plainLen = (list) =>
    list.map(([k, l]) => `${k} ${l}`).join(sep).length;

  for (const dropKey of dropPriority) {
    if (plainLen(active) + 1 <= maxWidth) break;
    if (active.length <= 2) break;
    active = active.filter(([k]) => k !== dropKey);
  }

  // Fallback compact labels if ultra narrow
  if (plainLen(active) + 1 > maxWidth) {
    active = [
      ['Space', 'Play'],
      ['?', 'Help'],
      ['q', 'Quit']
    ];
    if (plainLen(active) + 1 > maxWidth) {
      active = [
        ['?', 'Help'],
        ['q', 'Quit']
      ];
    }
    if (plainLen(active) + 1 > maxWidth) {
      active = [['q', 'Quit']];
    }
  }

  const formatted = active
    .map(([k, label]) => `{bold}{${theme.textFg}-fg}${k}{/} {${theme.dimFg}-fg}${label}{/}`)
    .join(sep);

  return ` ${formatted}`;
}

// --- Playback & Data Logic ---
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

async function getCachedDuration(songName) {
  if (songDurations.has(songName)) {
    return songDurations.get(songName);
  }
  const dur = await getSongDuration(path.join(songDir, songName));
  songDurations.set(songName, dur);
  return dur;
}

async function preloadAllDurations() {
  const queue = [...allSongs];
  const concurrency = 4;

  async function worker() {
    while (queue.length > 0 && !isExiting) {
      const songName = queue.shift();
      if (!songName || songDurations.has(songName)) continue;
      await getCachedDuration(songName);
      if (!isExiting && screen) {
        updatePlaylistItems();
        screen.render();
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);
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
      if (!searchMode && !helpModalOpen) {
        renderNowPlaying();
        screen.render();
      }
    }
  }, 250);
}

async function playTrack(orderIndex) {
  if (filteredSongs.length === 0) return;
  const clampedIdx = Math.max(0, Math.min(orderIndex, filteredSongs.length - 1));
  const trackInfo = filteredSongs[clampedIdx];
  if (!trackInfo) return;

  const reqId = ++playRequestId;
  cursor = clampedIdx;
  playingIndex = trackInfo.originalIndex;
  isPaused = false;
  isStopped = false;

  stopCurrentPlayback();

  const songPath = path.join(songDir, trackInfo.name);
  totalDuration = await getCachedDuration(trackInfo.name);
  if (reqId !== playRequestId || isExiting) return;

  timeElapsed = 0;

  // Launch VLC rc mode headlessly with piped stdio so terminal stays clean
  vlcPlayProcess = spawn('vlc', ['--intf', 'rc', '--no-video', songPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  vlcPlayProcess.on('error', () => {
    // Silently handle error
  });

  // Set initial volume
  const vlcVol = isMuted ? 0 : Math.floor((volume / 100) * 256);
  if (vlcPlayProcess.stdin.writable) {
    vlcPlayProcess.stdin.write(`volume ${vlcVol}\n`);
  }

  startElapsedTracking();
  updatePlaylistItems();
  renderNowPlaying();
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
  renderNowPlaying();
  screen.render();
}

function handleTrackEnd() {
  if (repeatMode === 'one') {
    playTrack(cursor);
  } else if (repeatMode === 'all') {
    const nextIdx = (cursor + 1) % filteredSongs.length;
    playTrack(nextIdx);
  } else {
    if (cursor < filteredSongs.length - 1) {
      playTrack(cursor + 1);
    } else {
      isPaused = true;
      isStopped = true;
      timeElapsed = totalDuration;
      stopCurrentPlayback();
      updatePlaylistItems();
      renderNowPlaying();
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
  renderNowPlaying();
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
  renderNowPlaying();
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
  renderNowPlaying();
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
  renderNowPlaying();
  screen.render();
}

function cycleRepeat() {
  if (repeatMode === 'off') repeatMode = 'all';
  else if (repeatMode === 'all') repeatMode = 'one';
  else repeatMode = 'off';
  renderNowPlaying();
  screen.render();
}

function cycleTheme() {
  const keys = Object.keys(THEMES);
  const currentIdx = keys.indexOf(currentThemeKey);
  currentThemeKey = keys[(currentIdx + 1) % keys.length];
  applyTheme();
  screen.render();
}

function clearSearchFilter() {
  if (!searchQuery) return;
  const currentSongName = playingIndex !== -1 ? allSongs[playingIndex] : null;
  searchQuery = '';
  updateFilteredSongs();
  if (currentSongName) {
    const restoredIdx = filteredSongs.findIndex((s) => s.name === currentSongName);
    cursor = restoredIdx !== -1 ? restoredIdx : 0;
  } else {
    cursor = 0;
  }
  renderPlaylistHeader();
  updatePlaylistItems();
  renderBottomBar();
  screen.render();
}

// --- UI Rendering ---
function renderPlaylistHeader() {
  if (!playlistHeader || !playlistPanel) return;
  const t = getTheme();
  const innerW = Math.max(10, playlistHeader.width || 30);
  const contentW = Math.max(8, innerW - 2);
  const innerH = Math.max(2, (playlistPanel.height || 10) - 2);

  let leftText = `{bold}{${t.textFg}-fg}Playlist{/}`;
  let leftLen = 'Playlist'.length;

  let rightPlain = `${allSongs.length} ${allSongs.length === 1 ? 'track' : 'tracks'}`;
  if (searchQuery) {
    const maxQ = Math.max(5, Math.floor(contentW * 0.35));
    const qDisplay = truncateText(searchQuery, maxQ);
    leftText += `  {${t.green}-fg}"${blessed.escape(qDisplay)}"{/}`;
    leftLen += 2 + qDisplay.length + 2;
    const fullRight = `${filteredSongs.length}/${allSongs.length}  Esc clear`;
    const shortRight = `${filteredSongs.length}/${allSongs.length}`;
    rightPlain = leftLen + 1 + fullRight.length <= contentW ? fullRight : shortRight;
  }

  const gap = Math.max(1, contentW - leftLen - rightPlain.length);
  const showRight = leftLen + 1 + rightPlain.length <= contentW;
  const headerLine = showRight
    ? `${leftText}${' '.repeat(gap)}{${t.dimFg}-fg}${rightPlain}{/}`
    : leftText;

  const lines = [headerLine];
  if (innerH >= 6) {
    lines.push(`{${t.dividerFg}-fg}${'─'.repeat(Math.max(4, innerW - 1))}{/}`);
  }
  playlistHeader.setContent(lines.join('\n'));
}

function updatePlaylistItems() {
  if (!playlistWidget || !playlistPanel) return;
  const t = getTheme();

  if (filteredSongs.length === 0) {
    playlistWidget.setItems([]);
    if (emptyPlaylistBox) {
      emptyPlaylistBox.setContent(
        searchQuery
          ? `{${t.mutedFg}-fg}No tracks match "${blessed.escape(searchQuery)}"{/}\n\n{${t.dimFg}-fg}Press Esc to clear filter{/}`
          : `{${t.dimFg}-fg}No tracks available{/}`
      );
      emptyPlaylistBox.show();
    }
    return;
  }

  if (emptyPlaylistBox) emptyPlaylistBox.hide();

  const listW = Math.max(14, (playlistWidget.width || 30) - 2);
  const indexWidth = Math.max(2, String(filteredSongs.length).length);
  const showDuration = listW >= 20;

  const items = filteredSongs.map((songObj, idx) => {
    const isThisPlaying = songObj.originalIndex === playingIndex && !isStopped;
    const isThisPaused = isThisPlaying && isPaused;

    const numStr = String(idx + 1).padStart(indexWidth, ' ');
    const activeGlyph = isThisPaused ? '‖' : '▸';
    const prefixPlain = isThisPlaying
      ? `${' '.repeat(indexWidth - 1)}${activeGlyph}  `
      : `${numStr}  `;

    const durStr = songDurations.has(songObj.name)
      ? formatTime(songDurations.get(songObj.name))
      : '--:--';
    const rightPlain = showDuration ? ` ${durStr}` : '';

    const titleBudget = Math.max(4, listW - prefixPlain.length - rightPlain.length);
    const cleanTitle = stripExtension(songObj.name);
    const truncated = truncateText(cleanTitle, titleBudget);
    const padding = ' '.repeat(Math.max(0, titleBudget - truncated.length));
    const escapedTitle = blessed.escape(truncated);

    if (isThisPlaying) {
      const greenTone = isThisPaused ? t.green : t.greenBright;
      const prefixTag = `{bold}{${greenTone}-fg}${prefixPlain}{/}`;
      const titleTag = `{bold}{${greenTone}-fg}${escapedTitle}{/}${padding}`;
      const durTag = showDuration ? `{${t.green}-fg}${rightPlain}{/}` : '';
      return `${prefixTag}${titleTag}${durTag}`;
    }

    const prefixTag = `{${t.dimFg}-fg}${prefixPlain}{/}`;
    const durTag = showDuration ? `{${t.mutedFg}-fg}${rightPlain}{/}` : '';
    return `${prefixTag}${escapedTitle}${padding}${durTag}`;
  });

  isUpdatingList = true;
  try {
    playlistWidget.setItems(items);
    if (filteredSongs.length > 0) {
      cursor = Math.max(0, Math.min(cursor, filteredSongs.length - 1));
      playlistWidget.select(cursor);
    }
  } finally {
    isUpdatingList = false;
  }
}

function renderNowPlaying() {
  if (!nowPlayingPanel || !nowPlayingContent) return;
  const t = getTheme();
  const innerW = Math.max(12, nowPlayingContent.width || 34);
  const innerH = Math.max(3, nowPlayingContent.height || 16);
  const contentW = Math.max(10, innerW - 1);
  const compact = innerH < 9;

  const hasTrack = playingIndex !== -1 && Boolean(allSongs[playingIndex]);
  const rawTitle = hasTrack ? stripExtension(allSongs[playingIndex]) : 'No track playing';

  // Progress line
  const elapsedStr = formatTime(timeElapsed);
  const totalStr = formatTime(totalDuration);
  const timeGap = contentW >= 28 ? '  ' : ' ';
  const barW = Math.max(4, contentW - elapsedStr.length - totalStr.length - timeGap.length * 2);
  const progressBar = buildProgressBarString(
    timeElapsed,
    totalDuration,
    barW,
    t,
    isPaused || isStopped
  );
  const progressLine =
    `{${t.mutedFg}-fg}${elapsedStr}{/}${timeGap}` +
    `${progressBar}${timeGap}` +
    `{${t.mutedFg}-fg}${totalStr}{/}`;

  // Playback controls + shuffle/repeat (shown once)
  const shuffleStr = shuffleOn
    ? `{${t.greenBright}-fg}⇄ on{/}`
    : `{${t.dimFg}-fg}⇄ off{/}`;
  const repeatStr =
    repeatMode === 'off'
      ? `{${t.dimFg}-fg}↻ off{/}`
      : `{${t.greenBright}-fg}↻ ${repeatMode}{/}`;

  let playLabel;
  let playGlyph;
  if (isStopped || !hasTrack) {
    playLabel = `{${t.dimFg}-fg}■ Stopped{/}`;
    playGlyph = `{${t.dimFg}-fg}■{/}`;
  } else if (isPaused) {
    playLabel = `{bold}{${t.mutedFg}-fg}‖ Paused{/}`;
    playGlyph = `{bold}{${t.mutedFg}-fg}‖{/}`;
  } else {
    playLabel = `{bold}{${t.greenBright}-fg}▶ Playing{/}`;
    playGlyph = `{bold}{${t.greenBright}-fg}▶{/}`;
  }

  const prevGlyph = `{${t.mutedFg}-fg}◂◂{/}`;
  const nextGlyph = `{${t.mutedFg}-fg}▸▸{/}`;

  let controlsLine;
  if (contentW >= 36) {
    controlsLine = `${shuffleStr}   ${prevGlyph}  ${playLabel}  ${nextGlyph}   ${repeatStr}`;
  } else if (contentW >= 26) {
    controlsLine = `${shuffleStr}  ${prevGlyph} ${playGlyph} ${nextGlyph}  ${repeatStr}`;
  } else {
    const sShort = shuffleOn ? `{${t.greenBright}-fg}⇄{/}` : `{${t.dimFg}-fg}⇄{/}`;
    const rShort = repeatMode === 'off' ? `{${t.dimFg}-fg}↻{/}` : `{${t.greenBright}-fg}↻${repeatMode[0]}{/}`;
    controlsLine = `${sShort} ${prevGlyph} ${playGlyph} ${nextGlyph} ${rShort}`;
  }

  // Volume bar (shown once)
  const volLabel = `{${t.dimFg}-fg}Vol{/}`;
  const volValueText = isMuted ? 'Muted' : `${volume}%`;
  const volRight = isMuted
    ? `{${t.dangerFg}-fg}Muted{/}`
    : `{${t.mutedFg}-fg}${volValueText}{/}`;
  const volBarW = Math.max(4, Math.min(20, contentW - 3 - 5 - 4));
  let volBar;
  if (isMuted) {
    volBar = `{${t.barEmpty}-fg}${'─'.repeat(volBarW)}{/}`;
  } else {
    const vFilled = Math.round((volBarW * volume) / 100);
    const vEmpty = Math.max(0, volBarW - vFilled);
    volBar = `{${t.green}-fg}${'━'.repeat(vFilled)}{/}{${t.barEmpty}-fg}${'─'.repeat(vEmpty)}{/}`;
  }
  const volumeLine = `${volLabel}  ${volBar}  ${volRight}`;

  if (compact) {
    const titleLines = wrapTextLines(rawTitle, contentW, 1).map((line) =>
      hasTrack
        ? `{bold}{${t.textFg}-fg}${blessed.escape(line)}{/}`
        : `{${t.dimFg}-fg}${blessed.escape(line)}{/}`
    );
    const rows = [titleLines[0], progressLine, controlsLine];
    if (innerH >= 4) rows.push(volumeLine);
    const compactTopPad = innerH > rows.length ? Math.floor((innerH - rows.length) / 2) : 0;
    nowPlayingContent.top = 0;
    nowPlayingContent.setContent([...Array(compactTopPad).fill(''), ...rows].join('\n'));
    return;
  }

  // Standard layout with header matching Playlist panel
  const titleLines = wrapTextLines(rawTitle, contentW, 2).map((line) =>
    hasTrack
      ? `{bold}{${t.textFg}-fg}${blessed.escape(line)}{/}`
      : `{${t.dimFg}-fg}${blessed.escape(line)}{/}`
  );

  const bodyLines = [
    ...titleLines,
    '',
    progressLine,
    '',
    controlsLine,
    '',
    volumeLine
  ];

  const availableBodyH = Math.max(1, innerH - 2);
  const topPad = availableBodyH > bodyLines.length
    ? Math.floor((availableBodyH - bodyLines.length) / 2)
    : 0;

  const headerLines = [
    `{${t.dimFg}-fg}Now Playing{/}`,
    `{${t.dividerFg}-fg}${'─'.repeat(contentW)}{/}`
  ];

  const paddedBody = [
    ...headerLines,
    ...Array(topPad).fill(''),
    ...bodyLines
  ];

  nowPlayingContent.top = 0;
  nowPlayingContent.setContent(paddedBody.join('\n'));
}

function renderBottomBar() {
  if (!bottomBar) return;
  const t = getTheme();
  const maxW = Math.max(12, (bottomBar.width || 80) - 2);
  bottomBar.setContent(buildBottomHintsLine(maxW, t, Boolean(searchQuery)));
}

function renderHelpModal() {
  if (!helpModal || !screen) return;
  const t = getTheme();
  const sw = screen.width || 80;
  const sh = screen.height || 24;

  const shortcuts = [
    ['Space', 'Play / Pause'],
    ['Enter', 'Play selected'],
    ['n', 'Next track'],
    ['b', 'Previous track'],
    ['← / →', 'Seek -5s / +5s'],
    ['↑ / ↓', 'Navigate list'],
    ['+ / -', 'Volume +/- 5%'],
    ['m', 'Mute / Unmute'],
    ['s', 'Toggle shuffle'],
    ['r', 'Cycle repeat'],
    ['/', 'Search tracks'],
    ['Esc', 'Clear / Close'],
    ['t', 'Dark contrast'],
    ['?', 'Shortcuts'],
    ['q', 'Quit']
  ];

  const useTwoCols = sw >= 60 && sh >= 16;
  const modalW = useTwoCols ? Math.min(58, sw - 4) : Math.min(36, sw - 2);
  const desiredH = useTwoCols ? 13 : Math.min(shortcuts.length + 5, sh - 2);
  const modalH = Math.max(8, Math.min(desiredH, sh - 2));

  helpModal.width = modalW;
  helpModal.height = modalH;
  helpModal.top = Math.max(0, Math.floor((sh - modalH) / 2));
  helpModal.left = Math.max(0, Math.floor((sw - modalW) / 2));

  const lines = [];
  const keyW = 9;
  if (useTwoCols) {
    const half = Math.ceil(shortcuts.length / 2);
    const innerModalW = modalW - 4; // 2 border + 2 horizontal padding
    const colW = Math.floor((innerModalW - 3) / 2);
    for (let i = 0; i < half; i++) {
      const leftItem = shortcuts[i];
      const rightItem = shortcuts[i + half];
      const fmtEntry = ([k, desc]) => {
        const descW = Math.max(4, colW - keyW);
        const keyCol = k.padEnd(keyW, ' ');
        const descCol = truncateText(desc, descW).padEnd(descW, ' ');
        return `{bold}{${t.greenBright}-fg}${keyCol}{/}{${t.mutedFg}-fg}${descCol}{/}`;
      };
      const leftStr = leftItem ? fmtEntry(leftItem) : ' '.repeat(colW);
      const rightStr = rightItem ? fmtEntry(rightItem) : '';
      lines.push(` ${leftStr}  ${rightStr}`);
    }
  } else {
    const innerW = Math.max(16, modalW - 4);
    for (const [k, desc] of shortcuts) {
      const keyCol = k.padEnd(keyW, ' ');
      const descCol = truncateText(desc, Math.max(4, innerW - keyW - 1));
      lines.push(` {bold}{${t.greenBright}-fg}${keyCol}{/}{${t.mutedFg}-fg}${descCol}{/}`);
    }
  }

  lines.push('');
  lines.push(` {${t.dimFg}-fg}Press ? or Esc to close{/}`);
  helpModal.setContent(lines.join('\n'));
}

function positionSearchBox() {
  if (!searchInputBox || !screen) return;
  const sw = screen.width || 80;
  const sh = screen.height || 24;
  const boxW = Math.max(24, Math.min(60, sw - 4));
  searchInputBox.width = boxW;
  searchInputBox.left = Math.max(0, Math.floor((sw - boxW) / 2));
  searchInputBox.top = Math.max(1, Math.floor((sh - 3) / 2));
}

function applyResponsiveLayout() {
  if (!screen || !playlistPanel || !nowPlayingPanel || !bottomBar) return;
  const layout = computeLayout(screen.width, screen.height);

  playlistPanel.top = layout.playlist.top;
  playlistPanel.left = layout.playlist.left;
  playlistPanel.width = layout.playlist.width;
  playlistPanel.height = layout.playlist.height;

  const pInnerW = Math.max(10, layout.playlist.width - 2);
  const pInnerH = Math.max(2, layout.playlist.height - 2);
  const pPadX = pInnerW >= 26 ? 1 : 0;
  const pHeaderH = pInnerH >= 6 ? 2 : 1;

  playlistHeader.top = 0;
  playlistHeader.left = pPadX;
  playlistHeader.width = Math.max(8, pInnerW - pPadX * 2);
  playlistHeader.height = pHeaderH;

  playlistWidget.top = pHeaderH;
  playlistWidget.left = pPadX;
  playlistWidget.width = Math.max(8, pInnerW - pPadX * 2);
  playlistWidget.height = Math.max(1, pInnerH - pHeaderH);

  emptyPlaylistBox.top = pHeaderH;
  emptyPlaylistBox.left = pPadX;
  emptyPlaylistBox.width = Math.max(8, pInnerW - pPadX * 2);
  emptyPlaylistBox.height = Math.max(2, pInnerH - pHeaderH);

  nowPlayingPanel.top = layout.nowPlaying.top;
  nowPlayingPanel.left = layout.nowPlaying.left;
  nowPlayingPanel.width = layout.nowPlaying.width;
  nowPlayingPanel.height = layout.nowPlaying.height;

  const nInnerW = Math.max(10, layout.nowPlaying.width - 2);
  const nInnerH = Math.max(2, layout.nowPlaying.height - 2);
  const nPadX = nInnerW >= 26 ? 1 : 0;
  nowPlayingContent.top = 0;
  nowPlayingContent.left = nPadX;
  nowPlayingContent.width = Math.max(8, nInnerW - nPadX * 2);
  nowPlayingContent.height = nInnerH;

  bottomBar.top = layout.bottom.top;
  bottomBar.left = layout.bottom.left;
  bottomBar.width = layout.bottom.width;
  bottomBar.height = layout.bottom.height;

  positionSearchBox();
  if (helpModalOpen) renderHelpModal();
}

function applyTheme() {
  const t = getTheme();

  rootBox.style.bg = t.screenBg;

  playlistPanel.style.bg = t.panelBg;
  playlistPanel.style.fg = t.textFg;
  playlistPanel.style.border.fg = t.borderFg;
  playlistPanel.style.border.bg = t.panelBg;

  playlistHeader.style.bg = t.panelBg;
  playlistHeader.style.fg = t.textFg;

  playlistWidget.style.bg = t.panelBg;
  playlistWidget.style.fg = t.textFg;
  playlistWidget.style.item.bg = t.panelBg;
  playlistWidget.style.item.fg = t.textFg;
  playlistWidget.style.selected.bg = t.selectedBg;
  playlistWidget.style.selected.fg = t.textFg;
  if (playlistWidget.scrollbar) {
    playlistWidget.style.scrollbar = { bg: t.barEmpty };
  }

  emptyPlaylistBox.style.bg = t.panelBg;
  emptyPlaylistBox.style.fg = t.dimFg;

  nowPlayingPanel.style.bg = t.panelBg;
  nowPlayingPanel.style.fg = t.textFg;
  nowPlayingPanel.style.border.fg = t.borderFg;
  nowPlayingPanel.style.border.bg = t.panelBg;
  nowPlayingContent.style.bg = t.panelBg;
  nowPlayingContent.style.fg = t.textFg;

  bottomBar.style.bg = t.barBg;
  bottomBar.style.fg = t.dimFg;

  searchInputBox.style.bg = t.barBg;
  searchInputBox.style.fg = t.textFg;
  searchInputBox.style.border.fg = t.green;

  helpModal.style.bg = t.barBg;
  helpModal.style.fg = t.textFg;
  helpModal.style.border.fg = t.green;

  renderPlaylistHeader();
  updatePlaylistItems();
  renderNowPlaying();
  renderBottomBar();
  if (helpModalOpen) renderHelpModal();
}

// --- Player Initialization ---
function startPlayer(options) {
  songDir = path.resolve(options.dir || './songs');
  shuffleOn = Boolean(options.shuffle);
  repeatMode = options.repeat ? 'all' : 'off';
  volume = parseInt(options.volume, 10);
  if (isNaN(volume)) volume = 80;
  volume = Math.max(0, Math.min(100, volume));

  if (!fs.existsSync(songDir)) {
    console.error(`Error: Song directory does not exist: ${songDir}`);
    process.exit(1);
  }

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
    title: 'XPlayer',
    fullUnicode: true,
    mouse: true,
    warning: true
  });

  const t = getTheme();

  rootBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    style: { bg: t.screenBg }
  });

  // Left Panel: Playlist
  playlistPanel = blessed.box({
    parent: rootBox,
    tags: true,
    border: { type: 'line' },
    style: {
      bg: t.panelBg,
      fg: t.textFg,
      border: { fg: t.borderFg, bg: t.panelBg }
    }
  });

  playlistHeader = blessed.box({
    parent: playlistPanel,
    tags: true,
    wrap: false,
    style: { bg: t.panelBg, fg: t.textFg }
  });

  playlistWidget = blessed.list({
    parent: playlistPanel,
    keys: false,
    mouse: true,
    tags: true,
    scrollbar: {
      ch: ' ',
      track: { bg: t.panelBg },
      style: { bg: t.barEmpty }
    },
    style: {
      bg: t.panelBg,
      fg: t.textFg,
      item: { bg: t.panelBg, fg: t.textFg },
      selected: { bg: t.selectedBg, fg: t.textFg, bold: true }
    }
  });

  emptyPlaylistBox = blessed.box({
    parent: playlistPanel,
    hidden: true,
    align: 'center',
    valign: 'middle',
    tags: true,
    style: { bg: t.panelBg, fg: t.dimFg }
  });

  // Right Panel: Compact Now Playing
  nowPlayingPanel = blessed.box({
    parent: rootBox,
    tags: true,
    border: { type: 'line' },
    style: {
      bg: t.panelBg,
      fg: t.textFg,
      border: { fg: t.borderFg, bg: t.panelBg }
    }
  });

  nowPlayingContent = blessed.box({
    parent: nowPlayingPanel,
    tags: true,
    wrap: false,
    style: { bg: t.panelBg, fg: t.textFg }
  });

  // Slim Bottom Hints Bar
  bottomBar = blessed.box({
    parent: rootBox,
    tags: true,
    wrap: false,
    style: { bg: t.barBg, fg: t.dimFg }
  });

  // Search Input Overlay
  searchInputBox = blessed.textbox({
    parent: rootBox,
    height: 3,
    hidden: true,
    label: ' Search (Enter to filter, Esc to cancel) ',
    border: { type: 'line' },
    inputOnFocus: false,
    padding: { left: 1, right: 1 },
    style: {
      bg: t.barBg,
      fg: t.textFg,
      border: { fg: t.green },
      label: { fg: t.greenBright, bold: true }
    }
  });

  // Shortcuts Help Modal (hidden until '?' pressed)
  helpModal = blessed.box({
    parent: rootBox,
    hidden: true,
    tags: true,
    wrap: false,
    scrollable: true,
    keys: false,
    mouse: true,
    label: ' Keyboard Shortcuts ',
    border: { type: 'line' },
    padding: { top: 1, left: 1, right: 1 },
    style: {
      bg: t.barBg,
      fg: t.textFg,
      border: { fg: t.green },
      label: { fg: t.greenBright, bold: true }
    }
  });

  // Sync mouse selection with cursor without letting setItems() clobber cursor
  playlistWidget.on('select item', (_, index) => {
    if (!isUpdatingList) {
      cursor = index;
    }
  });

  playlistWidget.on('select', (_, index) => {
    if (helpModalOpen || searchMode) return;
    playTrack(index);
  });

  function toggleHelpModal(forceState) {
    helpModalOpen = typeof forceState === 'boolean' ? forceState : !helpModalOpen;
    if (helpModalOpen) {
      renderHelpModal();
      helpModal.show();
      helpModal.setFront();
    } else {
      helpModal.hide();
      renderNowPlaying();
    }
    screen.render();
  }

  function enterSearchMode() {
    searchMode = true;
    positionSearchBox();
    searchInputBox.setValue('');
    searchInputBox.show();
    searchInputBox.setFront();
    searchInputBox.focus();
    screen.render();

    searchInputBox.readInput((err, value) => {
      if (err || value == null) {
        exitSearchMode();
        return;
      }
      const nextQuery = value.trim();
      const currentSongName = playingIndex !== -1 ? allSongs[playingIndex] : null;
      searchQuery = nextQuery;
      updateFilteredSongs();

      if (!nextQuery) {
        if (currentSongName) {
          const restoredIdx = filteredSongs.findIndex((s) => s.name === currentSongName);
          cursor = restoredIdx !== -1 ? restoredIdx : 0;
        } else {
          cursor = 0;
        }
        renderPlaylistHeader();
        updatePlaylistItems();
        renderBottomBar();
        exitSearchMode();
        return;
      }

      cursor = 0;
      renderPlaylistHeader();
      updatePlaylistItems();
      renderBottomBar();
      exitSearchMode();
      if (filteredSongs.length > 0) {
        playTrack(0);
      }
    });
  }

  function exitSearchMode() {
    searchMode = false;
    searchInputBox.hide();
    playlistWidget.focus();
    renderNowPlaying();
    screen.render();
  }

  function cleanupAndExit() {
    isExiting = true;
    stopCurrentPlayback();
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (screen) screen.destroy();
    process.exit(0);
  }

  // --- Keyboard Event Handling ---
  screen.on('keypress', (ch, key) => {
    if (key && key.ctrl && key.name === 'c') {
      cleanupAndExit();
      return;
    }

    if (searchMode) {
      return;
    }

    if (key && key.name === 'q') {
      cleanupAndExit();
      return;
    }

    if (helpModalOpen) {
      if (ch === '?' || (key && key.name === 'escape')) {
        toggleHelpModal(false);
      } else if (key && key.name === 'up') {
        helpModal.scroll(-1);
        screen.render();
      } else if (key && key.name === 'down') {
        helpModal.scroll(1);
        screen.render();
      }
      return;
    }

    if (ch === '?') {
      toggleHelpModal(true);
      return;
    }

    if (key && key.name === 'escape') {
      if (searchQuery) {
        clearSearchFilter();
      }
      return;
    }

    if (key && key.name === 'up') {
      if (filteredSongs.length > 0) {
        cursor = (cursor - 1 + filteredSongs.length) % filteredSongs.length;
        playlistWidget.select(cursor);
        screen.render();
      }
      return;
    }

    if (key && key.name === 'down') {
      if (filteredSongs.length > 0) {
        cursor = (cursor + 1) % filteredSongs.length;
        playlistWidget.select(cursor);
        screen.render();
      }
      return;
    }

    if (key && (key.name === 'return' || key.name === 'enter')) {
      playTrack(cursor);
      return;
    }

    if (key && key.name === 'space') {
      togglePlayPause();
      return;
    }

    if (key && key.name === 'right') {
      seekPlayback(5);
      return;
    }

    if (key && key.name === 'left') {
      seekPlayback(-5);
      return;
    }

    if (ch === 'n') {
      nextTrack();
      return;
    }

    if (ch === 'b') {
      previousTrack();
      return;
    }

    if (ch === '+' || ch === '=') {
      changeVolume(5);
      return;
    }

    if (ch === '-') {
      changeVolume(-5);
      return;
    }

    if (ch === 'm') {
      toggleMute();
      return;
    }

    if (ch === 's') {
      toggleShuffle();
      return;
    }

    if (ch === 'r') {
      cycleRepeat();
      return;
    }

    if (ch === 't') {
      cycleTheme();
      return;
    }

    if (ch === '/') {
      enterSearchMode();
    }
  });

  process.on('SIGINT', cleanupAndExit);
  process.on('SIGTERM', cleanupAndExit);
  process.on('exit', () => {
    isExiting = true;
    stopCurrentPlayback();
  });

  screen.on('resize', () => {
    applyResponsiveLayout();
    renderPlaylistHeader();
    updatePlaylistItems();
    renderNowPlaying();
    renderBottomBar();
    screen.render();
  });

  // Initial layout, theme, and render
  applyResponsiveLayout();
  applyTheme();
  screen.render();

  // Preload track durations asynchronously without blocking startup
  preloadAllDurations();

  // Auto-play first song
  playTrack(0);
}

if (require.main === module) {
  program.parse(process.argv);
}

module.exports = {
  THEMES,
  formatTime,
  stripExtension,
  truncateText,
  wrapTextLines,
  computeLayout,
  buildProgressBarString,
  buildBottomHintsLine
};
