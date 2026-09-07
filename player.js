const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const songDir = path.join(__dirname, 'songs');
let allSongs = null;
let cursor = 0;
let isPaused = true;
let vlcPlayProcess = undefined;

let totalDuration = undefined;
let timeElapsed = undefined;

// ADD THIS
let elapsedTimer = undefined;

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

    // ADD THIS
    if (elapsedTimer !== undefined) {
        clearInterval(elapsedTimer);
    }

    timeElapsed = 0;

    elapsedTimer = setInterval(() => {
        if (vlcPlayProcess !== undefined && !isPaused) {
            timeElapsed += 0.1;
        }

        listSongs(songDir);
    }, 100);
}


function renderBar(percentagePlayed) {
    const PROGRESS_BAR_WIDTH = 50;

    const playedCharC = Math.round(
        PROGRESS_BAR_WIDTH * percentagePlayed / 100
    );

    const progressBar =
        "X".repeat(playedCharC) +
        ".".repeat(PROGRESS_BAR_WIDTH - playedCharC);

    return progressBar;
}


function listSongs(songDirPath) {
    allSongs = fs.readdirSync(songDirPath);

    process.stdout.write("\x1B[2;1H");

    const menuText = allSongs.map((songName, index) => {
        return ("\r\x1B[0K" + (index === cursor ? '>' : '') + songName);
    }).join("\n");

    process.stdout.write(menuText + "\n");

    if (timeElapsed !== undefined && totalDuration !== undefined) {
        const percentagePlayed =
            ((timeElapsed / totalDuration) * 100).toFixed(2);

        process.stdout.write(
            `\r\x1B[0K${Math.ceil(timeElapsed)} / ${totalDuration} || ${percentagePlayed} %`
        );

        const bar = renderBar(percentagePlayed);

        process.stdout.write(`\n\x1B[0K${bar}`);
    }
}


async function playSong(cursor) {

    if (vlcPlayProcess !== undefined) {
        vlcPlayProcess.kill(15);
        vlcPlayProcess = undefined;
    }

    isPaused = false;

    const songFinalPath = path.join(songDir, allSongs[cursor]);

    totalDuration = await getSongDuration(songFinalPath);

    // KEEP THIS — but it now clears the previous interval
    startElapsedTracking();

    vlcPlayProcess = spawn(
        'vlc',
        ["--intf", "rc", songFinalPath]
    );
}


listSongs(songDir);

process.stdin.setRawMode(true);

process.stdin.on('data', (data) => {

    if (data[0] === 0x1b) {

        if (data[1] === 0x5b) {

            if (data[2] === 0x41) {
                // UP
                cursor = ((cursor - 1) % allSongs.length);

                if (cursor < 0) {
                    cursor += allSongs.length;
                }

            } else if (data[2] === 0x42) {
                // DOWN
                cursor = (cursor + 1) % allSongs.length;

            } else if (data[2] === 0x43) {
                // RIGHT = NEXT
                cursor = (cursor + 1) % allSongs.length;
                playSong(cursor);

            } else if (data[2] === 0x44) {
                // LEFT = PREVIOUS
                cursor = ((cursor - 1) % allSongs.length);

                if (cursor < 0) {
                    cursor += allSongs.length;
                }

                playSong(cursor);
            }
        }

        listSongs(songDir);
        return;
    }


    // N = NEXT
    if (data[0] === 110) {
        cursor = (cursor + 1) % allSongs.length;

        listSongs(songDir);
        playSong(cursor);
    }


    // B = PREVIOUS
    if (data[0] === 98) {
        cursor = ((cursor - 1) % allSongs.length);

        if (cursor < 0) {
            cursor += allSongs.length;
        }

        listSongs(songDir);
        playSong(cursor);
    }


    // ENTER = PLAY SELECTED
    if (data[0] === 0x0d) {
        playSong(cursor);
        return;
    }


    // CTRL+C
    if (data[0] === 0x03) {
        process.stdin.setRawMode(false);
        process.exit();
    }


    // P = PLAY / PAUSE
    if (data[0] === 112) {

        isPaused = !isPaused;

        if (vlcPlayProcess !== undefined) {
            vlcPlayProcess.stdin.write('pause\n');
        }
    }
});