#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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
      startPlayer(options);
  });


// --- Globals ---
let songDir = '';
let allSongs = [];
let playOrder = [];
let cursor = 0;
let isPaused = true;
let vlcPlayProcess = undefined;

let totalDuration = undefined;
let timeElapsed = undefined;
let elapsedTimer = undefined;

let volume = 80;
let isMuted = false;
let volumeBeforeMute = 80;

let shuffleOn = false;
let repeatMode = 'off'; // 'off' | 'all' | 'one'

let searchMode = false;
let searchQuery = "";
let searchResults = [];

// --- Helpers ---
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
    cursor = 0;
}

async function getSongDuration(songFilePath) {
    return new Promise((resolve, reject) => {
        const afinfoCP = spawn("afinfo", [songFilePath]);
        let output = "";
        afinfoCP.stdout.on("data", (data) => {
            output += data.toString();
        });
        afinfoCP.on("close", (code) => {
            if (code !== 0) {
                reject(new Error("afinfo could not read this file"));
                return;
            }
            const duration = output.split("estimated duration: ")[1];
            if (!duration) {
                reject(new Error("Could not get duration"));
                return;
            }
            resolve(Number(duration.split(".")[0]) + 1);
        });
    });
}

function startElapsedTracking() {
    if (elapsedTimer !== undefined) {
        clearInterval(elapsedTimer);
    }
    timeElapsed = 0;
    elapsedTimer = setInterval(() => {
        if (vlcPlayProcess !== undefined && !isPaused) {
            timeElapsed += 0.1;
        }
        listSongs();
    }, 500);
}

function renderBar(percentagePlayed) {
    const PROGRESS_BAR_WIDTH = 50;
    const playedCharC = Math.round(PROGRESS_BAR_WIDTH * percentagePlayed / 100);
    const progressBar = "X".repeat(playedCharC) + ".".repeat(PROGRESS_BAR_WIDTH - playedCharC);
    return progressBar;
}

function listSongs() {
    process.stdout.write("\x1B[2;1H");

    // Header
    const header = `[Shuffle: ${shuffleOn ? 'ON' : 'OFF'}] [Repeat: ${repeatMode.toUpperCase()}] [Vol: ${isMuted ? 'MUTE' : volume + '%'}]`;
    const controls = `Controls: [p] Play/Pause | [+/-] Vol | [</>] Seek | [s] Shuffle | [r] Repeat | [m] Mute | [/] Search | [Enter] Play`;
    process.stdout.write("\r\x1B[0K" + header + "\n\r\x1B[0K" + controls + "\n");
    
    // Search 
    if (searchMode) {
        process.stdout.write("\r\x1B[0KSearch: " + searchQuery + "\n");
        searchResults = [];
        const query = searchQuery.toLowerCase();
        for (let idx = 0; idx < allSongs.length; idx++) {
            if (allSongs[idx].toLowerCase().includes(query)) {
                searchResults.push({name: allSongs[idx], idx});
            }
        }
            
        const menuText = searchResults.map((song, index) => {
            return ("\r\x1B[0K" + (index === cursor ? '>' : ' ') + " " + song.name);
        }).join("\n");
        process.stdout.write(menuText + "\n\x1B[0J");
    } else {
        process.stdout.write("\r\x1B[0K\n");
        const menuText = playOrder.map((originalIndex, index) => {
            return ("\r\x1B[0K" + (index === cursor ? '>' : ' ') + " " + allSongs[originalIndex]);
        }).join("\n");
        process.stdout.write(menuText + "\n\x1B[0J");
    }

    // Progress Bar
    if (timeElapsed !== undefined && totalDuration !== undefined) {
        const percentagePlayed = Math.min(100, Math.max(0, (timeElapsed / totalDuration) * 100)).toFixed(2);
        process.stdout.write(`\n\r\x1B[0K${Math.ceil(timeElapsed)} / ${totalDuration} || ${percentagePlayed} %`);
        const bar = renderBar(percentagePlayed);
        process.stdout.write(`\n\x1B[0K${bar}`);
    }
}

async function playSong(cursorIndex) {
    if (vlcPlayProcess !== undefined) {
        vlcPlayProcess.kill(15);
        vlcPlayProcess = undefined;
    }

    isPaused = false;
    
    let actualSongIndex;
    if (searchMode) {
        if (searchResults.length === 0) return;
        actualSongIndex = searchResults[cursorIndex].idx;
    } else {
        actualSongIndex = playOrder[cursorIndex];
    }

    const songFinalPath = path.join(songDir, allSongs[actualSongIndex]);
    
    try {
        totalDuration = await getSongDuration(songFinalPath);
    } catch (e) {
        totalDuration = 0; // fallback if afinfo fails
    }

    startElapsedTracking();

    vlcPlayProcess = spawn('vlc', ["--intf", "rc", songFinalPath]);
    
    // set initial volume
    vlcPlayProcess.stdin.write(`volume ${Math.floor((volume / 100) * 256)}\n`); // VLC rc volume scale
}

function handleTrackEnd() {
    if (repeatMode === 'one') {
        playSong(cursor);
    } else if (repeatMode === 'all') {
        cursor = (cursor + 1) % (searchMode ? searchResults.length : playOrder.length);
        playSong(cursor);
    } else {
        // off
        const len = searchMode ? searchResults.length : playOrder.length;
        if (cursor < len - 1) {
            cursor++;
            playSong(cursor);
        } else {
            isPaused = true;
            timeElapsed = 0;
            if (vlcPlayProcess) vlcPlayProcess.kill(15);
            vlcPlayProcess = undefined;
        }
    }
}

function startPlayer(options) {
    songDir = path.resolve(options.dir);
    shuffleOn = options.shuffle;
    repeatMode = options.repeat ? 'all' : 'off';
    volume = parseInt(options.volume, 10);
    
    if (isNaN(volume)) volume = 80;
    
    if (!fs.existsSync(songDir)) {
        console.error("Song directory does not exist:", songDir);
        process.exit(1);
    }
    
    allSongs = fs.readdirSync(songDir).filter(f => !f.startsWith('.')); // basic filter for hidden files
    updatePlayOrder();

    process.stdout.write('\x1Bc'); // Clear screen

    listSongs();

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    } else {
        console.warn("Warning: stdin is not a TTY. Interactive features may not work.");
    }

    process.stdin.on('data', (data) => {
        const len = searchMode ? searchResults.length : playOrder.length;
        
        // --- Search Mode ---
        if (searchMode) {
            if (data[0] === 0x1b && data.length === 1) {
                // ESC to exit search
                searchMode = false;
                searchQuery = "";
                cursor = 0;
                listSongs();
                return;
            }
            if (data[0] === 0x0d) {
                // Enter to play
                if (searchResults.length > 0) {
                    playSong(cursor);
                }
                return;
            }
            if (data[0] === 0x7f || data[0] === 0x08) {
                // Backspace
                searchQuery = searchQuery.slice(0, -1);
                cursor = 0;
                listSongs();
                return;
            }
            
            // Handle up/down in search mode too
            if (data[0] === 0x1b && data[1] === 0x5b) {
                if (data[2] === 0x41) { cursor = (cursor - 1 + len) % len; listSongs(); return; } // UP
                if (data[2] === 0x42) { cursor = (cursor + 1) % len; listSongs(); return; } // DOWN
            }

            // Typeable characters
            if (data[0] >= 32 && data[0] <= 126) {
                searchQuery += String.fromCharCode(data[0]);
                cursor = 0;
                listSongs();
            }
            return;
        }

        // --- Normal Mode ---
        
        // Escape Sequences (Arrows)
        if (data[0] === 0x1b && data[1] === 0x5b) {
            if (data[2] === 0x41) { // UP
                cursor = (cursor - 1 + len) % len;
            } else if (data[2] === 0x42) { // DOWN
                cursor = (cursor + 1) % len;
            } else if (data[2] === 0x43) { // RIGHT = NEXT
                cursor = (cursor + 1) % len;
                playSong(cursor);
            } else if (data[2] === 0x44) { // LEFT = PREVIOUS
                cursor = (cursor - 1 + len) % len;
                playSong(cursor);
            }
            listSongs();
            return;
        }

        // CTRL+C
        if (data[0] === 0x03) {
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            process.stdout.write('\x1Bc'); // Clear screen on exit
            process.exit();
        }
        
        // ENTER = PLAY SELECTED
        if (data[0] === 0x0d) {
            playSong(cursor);
            return;
        }

        // P = PLAY / PAUSE
        if (data[0] === 112) {
            isPaused = !isPaused;
            if (vlcPlayProcess !== undefined) {
                vlcPlayProcess.stdin.write('pause\n');
            }
        }
        
        // + or = for Volume Up (handling keyboards without numpad +)
        if (data[0] === 0x2b || data[0] === 0x3d) {
            volume = Math.min(100, volume + 5);
            isMuted = false;
            if (vlcPlayProcess) vlcPlayProcess.stdin.write(`volume ${Math.floor((volume / 100) * 256)}\n`);
            listSongs();
        }
        
        // - = Volume Down
        if (data[0] === 0x2d) {
            volume = Math.max(0, volume - 5);
            isMuted = false;
            if (vlcPlayProcess) vlcPlayProcess.stdin.write(`volume ${Math.floor((volume / 100) * 256)}\n`);
            listSongs();
        }
        
        // m = Mute Toggle
        if (data[0] === 109) {
            if (isMuted) {
                volume = volumeBeforeMute;
                isMuted = false;
            } else {
                volumeBeforeMute = volume;
                volume = 0;
                isMuted = true;
            }
            if (vlcPlayProcess) vlcPlayProcess.stdin.write(`volume ${Math.floor((volume / 100) * 256)}\n`);
            listSongs();
        }

        // > = Seek Forward 5s
        if (data[0] === 0x3e) {
            if (vlcPlayProcess) {
                vlcPlayProcess.stdin.write(`seek +5s\n`);
                timeElapsed = Math.min(totalDuration, timeElapsed + 5);
                listSongs();
            }
        }

        // < = Seek Backward 5s
        if (data[0] === 0x3c) {
            if (vlcPlayProcess) {
                vlcPlayProcess.stdin.write(`seek -5s\n`);
                timeElapsed = Math.max(0, timeElapsed - 5);
                listSongs();
            }
        }
        
        // s = Toggle Shuffle
        if (data[0] === 115) {
            shuffleOn = !shuffleOn;
            let currentSongIdx = playOrder[cursor];
            updatePlayOrder();
            // Restore cursor to currently playing song if possible
            if (currentSongIdx !== undefined) {
                let newCursor = playOrder.indexOf(currentSongIdx);
                if (newCursor !== -1) cursor = newCursor;
            }
            listSongs();
        }
        
        // r = Cycle Repeat Mode
        if (data[0] === 114) {
            if (repeatMode === 'off') repeatMode = 'all';
            else if (repeatMode === 'all') repeatMode = 'one';
            else repeatMode = 'off';
            listSongs();
        }
        
        // / = Search / Filter Mode
        if (data[0] === 0x2f) {
            searchMode = true;
            searchQuery = "";
            cursor = 0;
            listSongs();
        }
        
        // Auto-advance logic simulation (since VLC rc doesn't cleanly emit 'ended' without complex polling)
        // We'll rely on timeElapsed reaching totalDuration inside the interval for now,
        // as a simple implementation of track ending.
    });

    // Check for track end in the interval
    setInterval(() => {
        if (!isPaused && totalDuration !== undefined && timeElapsed >= totalDuration) {
            // Give a little buffer before skipping to next
            if (timeElapsed > totalDuration + 0.5) {
                handleTrackEnd();
            }
        }
    }, 500);
}

program.parse();