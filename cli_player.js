const { spawn } = require('child_process');
const { join } = require('path')
const { readdirSync } = require('fs')

const SONG_DIR = './songs';
let songs = []

function listSongs(){
    const ls = spawn('ls', [SONG_DIR])

    ls.stdout.on('data', (data) => {
        songs = data.toString().trim().split('\n')

        songs.forEach((song, idx) => {
            console.log(idx, song)
        })

        console.log('Select a song: ')
    })
}

function playSong(songDir, idx){
    const songPath = join(songDir, songs[idx])
    spawn('afplay', [songPath])
}

process.stdin.on('data', (data) => {
    const idx = Number(data.toString().trim());

    if(songs[idx]){
        playSong(SONG_DIR, idx)
    } else{
        console.log('Invalid selection')
    }
})

listSongs(songs)