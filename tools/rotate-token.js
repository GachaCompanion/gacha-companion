// Token rotation utility — run locally, nothing shared in chat.
// Usage: node tools/rotate-token.js "github_pat_your_new_token"
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const newPat = process.argv[2];
if (!newPat || !newPat.startsWith('github')) {
  console.error('Usage: node tools/rotate-token.js "github_pat_..."');
  process.exit(1);
}

const key = crypto.randomBytes(32);
const iv  = crypto.randomBytes(16);
const c   = crypto.createCipheriv('aes-256-cbc', key, iv);
const enc = Buffer.concat([c.update(newPat, 'utf8'), c.final()]);

const keyHex = key.toString('hex');
const segs   = keyHex.match(/.{8}/g); // 8 segments of 8 hex chars
const ivHex  = iv.toString('hex');
const encHex = enc.toString('hex');

const dataRepoPath = path.join(__dirname, '..', 'electron', 'engine', 'dataRepo.js');
let src = fs.readFileSync(dataRepoPath, 'utf-8');

// Replace key segments
src = src.replace(
  /const _s1 = '[^']+', _s2 = '[^']+', _s3 = '[^']+', _s4 = '[^']+';\nconst _s5 = '[^']+', _s6 = '[^']+', _s7 = '[^']+', _s8 = '[^']+';/,
  `const _s1 = '${segs[0]}', _s2 = '${segs[1]}', _s3 = '${segs[2]}', _s4 = '${segs[3]}';\nconst _s5 = '${segs[4]}', _s6 = '${segs[5]}', _s7 = '${segs[6]}', _s8 = '${segs[7]}';`
);
src = src.replace(/const _iv  = '[^']+';/, `const _iv  = '${ivHex}';`);
src = src.replace(/const _enc = '[^']+';/, `const _enc = '${encHex}';`);

fs.writeFileSync(dataRepoPath, src, 'utf-8');
console.log('dataRepo.js updated with new encrypted token. No need to share anything in chat.');
