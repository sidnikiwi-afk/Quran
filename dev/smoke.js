#!/usr/bin/env node
/**
 * Visual smoke test for the Quran PWA.
 *
 * Serves ../app on an ephemeral port, drives the *real* app in headless Chrome,
 * triggers key states, screenshots each into ./screenshots/, and asserts a few
 * invariants (e.g. the landscape dual-page spread parity). Audio is muted; the
 * app's own functions are invoked directly, so no user gesture is needed.
 *
 * Run:  npm install && npm run smoke
 * Chrome path override:  CHROME_PATH="/path/to/Chrome" npm run smoke
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const APP_DIR = path.resolve(__dirname, '..', 'app');
const SHOT_DIR = path.resolve(__dirname, 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  throw new Error('No Chrome found. Set CHROME_PATH=/path/to/Chrome');
}

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(APP_DIR, p);
    if (!file.startsWith(APP_DIR)) { res.statusCode = 403; return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; return res.end('not found'); }
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({
    executablePath: findChrome(), headless: 'new', args: ['--no-sandbox', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  PAGEERROR:', e.message));

  const ready = () => page.waitForFunction(() => typeof state !== 'undefined' && state.metadata, { timeout: 10000 });

  // --- Scenario 1: portrait, ayah-by-ayah highlight (Al-A'raf 7:40) ---
  await page.setViewport({ width: 430, height: 880, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await ready();
  await page.evaluate(() => { audioState.mode = 'ayah'; playAyahAudio(7, 40); });
  await sleep(2800);
  await page.screenshot({ path: path.join(SHOT_DIR, '1-highlight-7_40.png') });
  const strips740 = await page.evaluate(() => document.querySelectorAll('.ayah-hl-strip').length);
  check('highlight 7:40 draws strips', strips740 > 0, `${strips740} strips, page ${await page.evaluate(() => state.currentPage)}`);

  // --- Scenario 2: portrait, Ayat al-Kursi (2:255) ---
  await page.evaluate(() => playAyahAudio(2, 255));
  await sleep(2200);
  await page.screenshot({ path: path.join(SHOT_DIR, '2-highlight-2_255.png') });
  check('highlight 2:255 draws strips', (await page.evaluate(() => document.querySelectorAll('.ayah-hl-strip').length)) > 0);

  // --- Scenario 3: landscape dual-page spread parity at Juz 17 (Al-Anbiya p448) ---
  await page.setViewport({ width: 1000, height: 500, deviceScaleFactor: 2 });
  await page.evaluate(() => { if (typeof updateDualPageMode === 'function') updateDualPageMode(); goToPage(448); });
  await sleep(2000);
  await page.screenshot({ path: path.join(SHOT_DIR, '3-dual-juz17.png') });
  const spread = await page.evaluate(() => {
    const a = document.getElementById('page-img'), b = document.getElementById('page-img-2');
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const left = ra.x < rb.x ? a : b, right = ra.x < rb.x ? b : a;
    const src = (el) => (el.src.match(/(\d+)\.webp/) || [])[1];
    return { dual: _isDualActive, left: src(left), right: src(right) };
  });
  check('dual-page active in landscape', spread.dual === true);
  // physical mushaf: lower page on the RIGHT, higher (Juz-17 start) on the LEFT
  check('Juz 17 spread = right 447 / left 448', spread.right === '447' && spread.left === '448', JSON.stringify(spread));

  // --- Scenario 4: surah jump sanity (Al-Mulk 67 -> page 786) ---
  await page.setViewport({ width: 430, height: 880, deviceScaleFactor: 2 });
  await page.evaluate(() => { if (typeof updateDualPageMode === 'function') updateDualPageMode(); goToPage(786); });
  await sleep(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, '4-surah-mulk.png') });

  await browser.close();
  server.close();

  console.log(`\nScreenshots in ${SHOT_DIR}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
