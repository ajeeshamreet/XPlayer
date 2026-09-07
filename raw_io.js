process.stdin.setRawMode(true)
process.stdin.on('data', (data) => {
    console.log(data.toString(), data)
    if(data[0] === 0x03){
        process.exit(0)
    }
    if(data[0] === 0x1b && data[1] === 0x5b){
        if(data[2] === 0x41){
            console.log('Up Arrow')
        }
        if(data[2] === 0x42){
            console.log('Down Arrow')
        }
    }
})