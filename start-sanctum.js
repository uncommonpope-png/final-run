const { spawn } = require('child_process');
const path = require('path');

const scriptPath = "C:\\Users\\User\\OneDrive\\Documents\\PROFIT BRAIN\\SCRIBE\\scribe-sanctum.js";
const proc = spawn('node', [scriptPath], {
  detached: true,
  stdio: 'ignore'
});

proc.unref();
console.log('Sanctum started with PID:', proc.pid);