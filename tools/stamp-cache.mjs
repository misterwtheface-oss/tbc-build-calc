// Cache-busting stamp: version the SPA's asset URLs by a content hash so a new
// deploy can never serve a stale app.js/style.css against a fresh index.html
// (GitHub Pages caches assets ~10min; a desync breaks the app). Run before deploy:
//   node tools/build-data.mjs && node tools/stamp-cache.mjs
// Idempotent: strips any prior ?v= before hashing, so re-runs are stable.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = s => s.replace(/\?v=[a-f0-9]+/g, '');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// hash the un-stamped content of every shipped asset (incl. data.js so data changes bust too)
const HASHED = ['app.js', 'style.css', 'engine.mjs', 'data/data.js'];
const v = createHash('sha256').update(HASHED.map(f => strip(read(f))).join('\n')).digest('hex').slice(0, 8);

// stamp index.html's <script>/<link> refs
let idx = strip(read('index.html'))
  .replace('href="style.css"', `href="style.css?v=${v}"`)
  .replace('src="app.js"', `src="app.js?v=${v}"`)
  .replace('src="data/data.js"', `src="data/data.js?v=${v}"`);
writeFileSync(join(ROOT, 'index.html'), idx);

// stamp app.js's ES-module import of engine.mjs (a query on the <script> tag can't reach it)
const app = strip(read('app.js')).replace("from './engine.mjs'", `from './engine.mjs?v=${v}'`);
writeFileSync(join(ROOT, 'app.js'), app);

console.log(`stamped cache version v=${v} (index.html + app.js engine import)`);
