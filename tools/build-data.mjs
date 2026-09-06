// Build data/data.js (window.TBC) from data/references/*.csv
// Mirrors the vs-build-calc MO: CSV references -> single generated data file the SPA includes.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'references');

// ---- hardened datasets (user-managed source-of-truth, e.g. external sheet) ----
// These files are NEVER written by tooling. A checksum lock guards them: if a
// hardened file changes, the build HALTS so a clobbered copy can't silently flow
// into data.js. An intentional update is accepted only via `--relock`.
const HARDENED = ['class.csv'];
const LOCK_PATH = join(REF, 'hardened.lock.json');
const RELOCK = process.argv.slice(2).includes('--relock');
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');

function enforceHardened() {
  const lock = existsSync(LOCK_PATH)
    ? JSON.parse(readFileSync(LOCK_PATH, 'utf8'))
    : { note: 'Source-of-truth files managed externally; never overwritten by tooling. On an intentional update, rebuild with: node tools/build-data.mjs --relock', files: {} };
  lock.files ||= {};
  let dirty = false;
  for (const f of HARDENED) {
    const p = join(REF, f);
    if (!existsSync(p)) throw new Error(`[hardened] ${f} is missing — restore it from the source sheet or 'git checkout -- data/references/${f}'`);
    const hash = sha256(p), rec = lock.files[f];
    if (!rec) { lock.files[f] = { sha256: hash }; dirty = true; console.log(`[hardened] locked ${f} (${hash.slice(0, 12)}…)`); }
    else if (rec.sha256 === hash) console.log(`[hardened] verified ${f} (${hash.slice(0, 12)}…)`);
    else if (RELOCK) { lock.files[f] = { sha256: hash }; dirty = true; console.log(`[hardened] RE-LOCKED ${f} → ${hash.slice(0, 12)}… (intentional update accepted)`); }
    else throw new Error(
      `[hardened] ${f} changed but was not re-locked.\n` +
      `  • If YOU updated it from the source sheet:  rerun with --relock to accept the new version.\n` +
      `  • If this was NOT intentional (a script overwrote it):  restore with 'git checkout -- data/references/${f}'.`);
  }
  if (dirty) writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n');
}
enforceHardened();

// minimal CSV parser (handles quoted fields with commas/newlines)
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function table(file) {
  const p = join(REF, file);
  if (!existsSync(p)) return [];
  const rows = parseCSV(readFileSync(p, 'utf8')).filter(r => r.some(c => c !== ''));
  const head = rows.shift();
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const num = v => (v === '' || v == null ? null : Number(v));

// Load a table with a strict schema: exact header set, required/unique key,
// numeric columns must parse. Throws (fails the build) on any drift so header
// changes or typos in the source-of-truth CSVs surface immediately.
function loadValidated(file, schema) {
  const p = join(REF, file);
  if (!existsSync(p)) throw new Error(`[${file}] missing at ${p}`);
  const raw = parseCSV(readFileSync(p, 'utf8')).filter(r => r.some(c => c !== ''));
  const head = raw.shift() || [];
  const want = new Set(schema.columns), got = new Set(head);
  const missing = schema.columns.filter(c => !got.has(c));
  const unexpected = head.filter(c => !want.has(c));
  if (missing.length || unexpected.length) {
    throw new Error(`[${file}] header mismatch — expected exactly [${schema.columns.join(', ')}]` +
      (missing.length ? `\n  missing: ${missing.join(', ')}` : '') +
      (unexpected.length ? `\n  unexpected: ${unexpected.join(', ')}` : ''));
  }
  const rows = raw.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  const seen = new Set();
  const errs = [];
  rows.forEach((r, i) => {
    const ln = i + 2;                                   // 1-based incl. header
    const key = r[schema.key];
    if (!key) errs.push(`row ${ln}: empty ${schema.key}`);
    else if (seen.has(key)) errs.push(`row ${ln}: duplicate ${schema.key} "${key}"`);
    else seen.add(key);
    for (const c of schema.numeric || []) {
      if (r[c] === '' || !Number.isFinite(Number(r[c]))) errs.push(`row ${ln} (${key}): non-numeric ${c}="${r[c]}"`);
    }
  });
  if (errs.length) throw new Error(`[${file}] ${errs.length} row error(s):\n  ${errs.slice(0, 20).join('\n  ')}`);
  return rows;
}

// ---- classes (team roster) ----
const CLASS_SCHEMA = {
  key: 'class_id',
  columns: ['class_id', 'class_name', 'character_name', 'source_act',
            'pow', 'foc', 'spd', 'tgh', 'dsc', 'agi', 'end', 'wis', 'tec',
            'sprite_path', 'data_version'],
  numeric: ['pow', 'foc', 'spd', 'tgh', 'dsc', 'agi', 'end', 'wis', 'tec'],
};
const classes = loadValidated('class.csv', CLASS_SCHEMA).map(r => ({
  id: r.class_id,
  name: r.class_name,
  character: r.character_name,
  act: r.source_act,
  base: { pow: num(r.pow), foc: num(r.foc), spd: num(r.spd), tgh: num(r.tgh), dsc: num(r.dsc),
          agi: num(r.agi), end: num(r.end), wis: num(r.wis), tec: num(r.tec) },
  sprite: r.sprite_path, version: r.data_version,
}));

// ---- supporting tables (loaded for later features) ----
const relics = table('relic.csv');
const skills = table('skill.csv');
const traits = table('trait.csv');
const distortions = table('distortion.csv');
const glossary = table('glossary.csv');

const data = {
  version: '0.9.2',
  builtAt: null,               // stamped by caller, avoids nondeterminism
  classes, relics, skills, traits, distortions, glossary,
};

const out = `// AUTO-GENERATED by tools/build-data.mjs — do not edit by hand.\nwindow.TBC = ${JSON.stringify(data)};\n`;
writeFileSync(join(ROOT, 'data', 'data.js'), out);
console.log(`data.js written: ${classes.length} classes, ${relics.length} relics, ${skills.length} skills, ${traits.length} traits, ${distortions.length} distortions, ${glossary.length} glossary`);
