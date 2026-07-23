// One-time encryption utility — run via: node tools/encrypt-pat.js "YOUR_PAT"
// Outputs the values to embed in electron/engine/dataRepo.js
const crypto = require('crypto');
const pat = process.argv[2];
if (!pat) { console.error('Usage: node tools/encrypt-pat.js "your_pat"'); process.exit(1); }
const key = crypto.randomBytes(32);
const iv  = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
const enc = Buffer.concat([cipher.update(pat, 'utf8'), cipher.final()]);
console.log('KEY=' + key.toString('hex'));
console.log('IV='  + iv.toString('hex'));
console.log('ENC=' + enc.toString('hex'));
