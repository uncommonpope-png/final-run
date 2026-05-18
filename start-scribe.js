const { spawn } = require('child_process');
const scriptPath = "C:\\Users\\User\\OneDrive\\Documents\\PROFIT BRAIN\\SCRIBE\\scribe.js";
const proc = spawn('node', [scriptPath], {
  cwd: "C:\\Users\\User\\OneDrive\\Documents\\PROFIT BRAIN\\SCRIBE",
  env: { ...process.env, PORT: '7777' },
  detached: true,
  stdio: 'ignore'
});
proc.unref();
console.log('SCRIBE started with PID:', proc.pid);