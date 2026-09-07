const { spawn } = require('node:child_process')
const { join } = require('node:path')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(process.execPath, [join(__dirname, '../node_modules/electron-vite/bin/electron-vite.js'), ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
