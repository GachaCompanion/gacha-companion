// Public data repository — unauthenticated fetch from gc-data.
const https = require('https');

const OWNER  = 'GachaCompanion';
const REPO   = 'gc-data';
const BRANCH = 'main';

function _repoFetch(filePath, binary) {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${filePath}`;
    const req = https.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': 'GachaTracker' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(c);
        resolve(binary ? buf : buf.toString('utf-8'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
  });
}

/**
 * Conditional fetch using If-None-Match. Pass a previously stored ETag to skip
 * re-downloading unchanged files. Returns:
 *   { notModified: true,  etag }            — 304: caller should use its cache
 *   { notModified: false, etag, body }       — 200: fresh content + new ETag
 */
function fetchRepoFileConditional(filePath, etag) {
  return new Promise((resolve, reject) => {
    const url     = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${filePath}`;
    const headers = { 'User-Agent': 'GachaTracker' };
    if (etag) headers['If-None-Match'] = etag;
    const req = https.get(url, { timeout: 20000, headers }, (res) => {
      if (res.statusCode === 304) {
        res.resume();
        resolve({ notModified: true, etag });
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const responseEtag = res.headers['etag'] ?? null;
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        resolve({ notModified: false, etag: responseEtag, body: Buffer.concat(c).toString('utf-8') });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
  });
}

/**
 * Fetches a text file from the private data repository.
 * @param {string} filePath  e.g. 'hsr/name-id-map.json'
 * @returns {Promise<string>}
 */
function fetchRepoFile(filePath)   { return _repoFetch(filePath, false); }

/**
 * Fetches a binary file from the private data repository.
 * @param {string} filePath  e.g. 'hsr/images/1001.png'
 * @returns {Promise<Buffer>}
 */
function fetchRepoBuffer(filePath) { return _repoFetch(filePath, true); }

module.exports = { fetchRepoFile, fetchRepoBuffer, fetchRepoFileConditional };
