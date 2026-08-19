const fs = require('fs');
const path = require('path');

// Auto-detect ngrok binary (local ngrok.exe on Windows or global ngrok CLI)
const localNgrok = path.join(__dirname, 'ngrok.exe');
const ngrokScript = fs.existsSync(localNgrok) ? localNgrok : 'ngrok';

module.exports = {
  apps: [
    {
      name: "bozorcha-bot",
      script: "main.py",
      interpreter: "python",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PYTHONUNBUFFERED: "1"
      }
    },
    {
      name: "ngrok-1c",
      script: ngrokScript,
      args: "http 8080",
      exec_mode: "fork",
      autorestart: true,
      watch: false
    }
  ]
};
