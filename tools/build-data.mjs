// Build data/data.js (window.TBC_DATA) from data/references/*.csv
//
// Data backend = EXTRACT-BORNE CSVs (session-14 pivot): the reference CSVs are the
// code-verified datamine extracts (from _tbc_extract/reports/), wired directly — no
// manual golden/hardening gate. Correctness is guarded two ways instead:
//   1. build-time DATA HYGIENE (this file): dangling refs, 404 assets, dup ids → a
//      report that FAILS the build on errors so a broken data.js can't ship.
//   2. ENGINE REGRESSION TESTS (tools/test.mjs): pin CALC_SPEC worked examples.
// Run: `node tools/build-data.mjs` (add `--strict` to promote warnings to errors).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'data', 'references');
const STRICT = process.argv.slice(2).includes('--strict');

// ── CSV (handles quoted fields with commas/newlines; tolerant of missing EOF newline) ──
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
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
  if (!existsSync(p)) throw new Error(`[${file}] missing at ${p}`);
  const rows = parseCSV(readFileSync(p, 'utf8')).filter(r => r.some(c => c !== ''));
  const head = rows.shift();
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const num = v => (v === '' || v == null || v === '-' ? null : Number(v));
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const parseParam = c => (!c || c === '-') ? []
  : String(c).replace(/[[\]]/g, '').split(';').map(x => Number(x.trim())).filter(Number.isFinite);

// Parse a relic's freeform `effect` text into structured stat modifiers so the engine
// can fold them into the effective-stat stack. Covers the high-confidence patterns only
// ("Increases X [and Y] by +N and +M%", "but decreases Z by K%", "Increases X by C.Cx Y");
// everything else is left situational (equipped + shown, not applied to stats).
const STAT_WORD = { power: 'pow', focus: 'foc', speed: 'spd', toughness: 'tgh', discipline: 'dsc',
  agility: 'agi', endurance: 'end', wisdom: 'wis', technique: 'tec' };
const ALL_KEYS = Object.values(STAT_WORD);
function parseRelicStatMods(effectRaw) {
  const e = String(effectRaw || '').replace(/SkillType\./g, '');
  const byKey = {};                                  // key -> { flat, pct }
  const scaleMods = [];
  const bump = (key, flat, pct) => { const m = byKey[key] ??= { flat: 0, pct: 0 }; m.flat += flat || 0; m.pct += pct || 0; };
  const keysOf = word => word.toLowerCase() === 'all attributes' ? ALL_KEYS : [STAT_WORD[word.toLowerCase()]];
  const STAT = 'Power|Focus|Speed|Toughness|Discipline|Agility|Endurance|Wisdom|Technique';
  // "Increases X [and Y] by +N[%] [and +M[%]]" — a number may be flat or percent (trailing %).
  const incr = new RegExp(`Increases (${STAT}|all attributes)(?: and (${STAT}))? by \\+?(\\d+)(%?)(?: and \\+?(\\d+)(%?))?`, 'gi');
  for (let m; (m = incr.exec(e));) {
    const stats = [...keysOf(m[1]), ...(m[2] ? keysOf(m[2]) : [])].filter(Boolean);
    const apply = (n, isPct) => { for (const k of stats) isPct ? bump(k, 0, n) : bump(k, n, 0); };
    apply(Number(m[3]), m[4] === '%');
    if (m[5] != null) apply(Number(m[5]), m[6] === '%');
  }
  // "[but] decreases Z by K[%]"
  const dec = new RegExp(`decreases (${STAT}) by \\+?(\\d+)(%?)`, 'gi');
  for (let m; (m = dec.exec(e));) {
    const k = STAT_WORD[m[1].toLowerCase()], n = Number(m[2]);
    m[3] === '%' ? bump(k, 0, -n) : bump(k, -n, 0);
  }
  // "Increases X by C.Cx Y" — stat-from-stat scaling (adds coef × base(Y) to X).
  const scale = new RegExp(`Increases (${STAT}) by (\\d*\\.?\\d+)x (${STAT})`, 'gi');
  for (let m; (m = scale.exec(e));)
    scaleMods.push({ stat: STAT_WORD[m[1].toLowerCase()], fromStat: STAT_WORD[m[3].toLowerCase()], coef: Number(m[2]) });
  const statMods = Object.entries(byKey).map(([stat, v]) => ({ stat, flat: v.flat, pct: v.pct }));
  return { statMods, scaleMods, effectModeled: statMods.length > 0 || scaleMods.length > 0 };
}

// ── Metadata: filter vocabulary (from the glossary) + entity tags ────────────
// The glossary embeds machine-readable tokens (SkillType.Fire, EffectIcon.power_up,
// Sprite.beast) across five dimensions. We derive ONE canonical filter list from them
// (`TBC_DATA.filters`), then tag each Skill/Relic with a subset of those filter keys.
// Tags are namespaced `<dimension>:<key>` (e.g. damage_type:Fire, skill_type:Ranged,
// attribute:pow, status:Buff, enemy_type:beast) so they're unambiguous and group cleanly.
function buildFilters(glossaryRows) {
  const map = new Map();                                    // tag -> filter object
  const add = (dimension, key, label, token, definition = '') => {
    const tag = `${dimension}:${key}`;
    if (!map.has(tag)) map.set(tag, { tag, dimension, key, label: label || key, token: token || '', definition });
  };
  for (const g of glossaryRows) {
    const cat = g.category, term = g.term || '', def = g.definition || '', blob = term + ' ' + def;
    const lead = term.match(/^(SkillType|EffectIcon|Sprite)\.(\S+)\s+(.+)$/);   // "SkillType.Fire Fire"
    if (lead) {
      const [, prefix, raw, label] = lead;
      if (prefix === 'EffectIcon' && cat === 'attributes')
        add('attribute', STAT_WORD[label.trim().toLowerCase()] || raw.replace(/_up$/, ''), label.trim(), `${prefix}.${raw}`, def);
      else if (prefix === 'SkillType' && cat === 'damage_types') add('damage_type', raw, label.trim(), `SkillType.${raw}`, def);
      else if (prefix === 'SkillType' && cat === 'skill_types') add('skill_type', raw, label.trim(), `SkillType.${raw}`, def);
    }
    if (cat === 'resist') {                                 // Buff / Debuff / Resist status filters
      for (const m of blob.matchAll(/SkillType\.(Buff|Debuff)\b/g)) add('status', m[1], m[1] + 's', `SkillType.${m[1]}`, def);
      if (/EffectIcon\.resist/.test(blob)) add('status', 'Resist', 'Resist', 'EffectIcon.resist', def);
    }
    for (const m of blob.matchAll(/Sprite\.(human|beast|mechanical|undead|plant|demon|anomaly)\b\s*([A-Z]\w+)?/gi))
      add('enemy_type', m[1].toLowerCase(), m[2] || (m[1][0].toUpperCase() + m[1].slice(1)), `Sprite.${m[1].toLowerCase()}`);
  }
  const filters = [...map.values()];
  return { filters, validTags: new Set(filters.map(f => f.tag)) };
}
// Resolve each filter to its game icon (extracted from battle_icons.png by
// _tbc_extract/tbc_extract_tag_icons.py → assets/tag/<frame>.png). Prefixes: EffectIcon → ei_,
// SkillType → si_, enemy Sprite → plain. Keep in sync with that extractor's NEEDED set.
function filterIcon({ dimension, key, token }) {
  let frame;
  if (dimension === 'attribute') frame = `ei_${token.replace('EffectIcon.', '')}.png`;   // ei_power_up.png
  else if (dimension === 'enemy_type') frame = `${key}.png`;                               // beast.png
  else if (dimension === 'skill_type') frame = `si_${key.toLowerCase()}.png`;              // si_attack.png
  else if (dimension === 'status') frame = key === 'Resist' ? 'ei_resist.png' : `si_${key.toLowerCase()}.png`;
  else if (dimension === 'damage_type')
    frame = ({ Healing: 'ei_healing_up.png', MPHealing: 'si_mphealing.png' })[key] || `ei_${key.toLowerCase()}.png`;
  return frame ? `assets/tag/${frame}` : null;
}
// Skill tags: damage type from the modifier's element (authoritative), skill-type/damage
// tokens from the skill's own text, and mechanic → glossary mapping (heal→Healing,
// summon→Summon, stat_mod→Buff + the attribute, status→Debuff [heuristic]). Filtered to the vocab.
function tagSkill(skill, mods, validTags) {
  const tags = new Set();
  for (const m of mods) {
    for (const el of String(m.element || '').split(';').map(s => s.trim()).filter(Boolean)) tags.add(`damage_type:${el}`);
    if (m.type === 'heal') tags.add('skill_type:Healing');
    if (m.type === 'summon') tags.add('skill_type:Summon');
    if (m.type === 'stat_mod' || m.type === 'stat_gain') {
      tags.add('status:Buff');
      const k = STAT_WORD[String(m.stat || '').toLowerCase()]; if (k) tags.add(`attribute:${k}`);
    }
    if (m.type === 'status') tags.add('status:Debuff');     // heuristic: applied statuses are usually enemy debuffs
  }
  const text = [skill.name, skill.short, ...(skill.levels || [])].join(' ');
  for (const tm of text.matchAll(/SkillType\.(\w+)/g)) { tags.add(`skill_type:${tm[1]}`); tags.add(`damage_type:${tm[1]}`); }
  return [...tags].filter(t => validTags.has(t));
}
// Relic tags: attributes it boosts (from parsed statMods/scaleMods), SkillType/damage tokens
// in its effect text, a Resist status, and — if it grants a skill — that skill's tags.
function tagRelic(relic, skillTagsByNorm, validTags) {
  const tags = new Set();
  for (const m of relic.statMods || []) tags.add(`attribute:${m.stat}`);
  for (const s of relic.scaleMods || []) { tags.add(`attribute:${s.stat}`); tags.add(`attribute:${s.fromStat}`); }
  for (const tm of String(relic.effect || '').matchAll(/SkillType\.(\w+)/g)) { tags.add(`skill_type:${tm[1]}`); tags.add(`damage_type:${tm[1]}`); }
  if (/\bResist\b/.test(relic.effect || '')) tags.add('status:Resist');
  if (relic.grantedSkill && relic.grantedSkill !== '-') {
    const st = skillTagsByNorm.get(norm(relic.grantedSkill));
    if (st) for (const t of st) tags.add(t);
  }
  return [...tags].filter(t => validTags.has(t));
}

// ── Hygiene accumulator ─────────────────────────────────────────────────────
const errors = [], warnings = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);
let assetsChecked = 0;
function checkAssets(records, field, kind, sev) {          // sev: 'error' | 'warn'
  for (const r of records) {
    const p = r[field];
    if (!p || p === '-') continue;
    assetsChecked++;
    if (!existsSync(join(ROOT, p))) {
      const msg = `${kind} "${r.id || r.name || r.tag}" → ${p} (missing on disk)`;
      sev === 'error' ? err(msg) : warn(msg);
    }
  }
}
function checkUniqueIds(records, kind) {
  const seen = new Set();
  for (const r of records) {
    if (!r.id) { err(`${kind} row has empty id`); continue; }
    if (seen.has(r.id)) err(`${kind} duplicate id "${r.id}"`);
    seen.add(r.id);
  }
}

// ── Load & normalize each table ─────────────────────────────────────────────
// Classes (team roster) — base stats are code-verified (§4.14 tiers).
const classes = table('class.csv').map(r => ({
  id: r.class_id, name: r.class_name, character: r.character_name, act: r.source_act,
  base: { pow: num(r.pow), foc: num(r.foc), spd: num(r.spd), tgh: num(r.tgh), dsc: num(r.dsc),
          agi: num(r.agi), end: num(r.end), wis: num(r.wis), tec: num(r.tec) },
  sprite: r.sprite_path, version: r.data_version,
}));
classes.forEach(c => {
  for (const k of ['pow','foc','spd','tgh','dsc','agi','end','wis','tec'])
    if (!Number.isFinite(c.base[k])) err(`class "${c.id}" non-numeric base ${k}`);
});

// Skills — skill_master.csv (861: computation + coefficients + text).
const skills = table('skill_master.csv').map(r => ({
  id: r.skill_id, codename: r.codename, name: r.name, short: r.short_name,
  category: r.category, nLevels: num(r.n_levels),
  levels: [r.level_1, r.level_2, r.level_3, r.level_4, r.level_5].filter(x => x && x !== '-'),
  param: parseParam(r.param), textSource: r.text_source,
  computation: r.computation, nModifiers: num(r.n_modifiers), modSummary: r.mod_summary,
}));
const skillIds = new Set(skills.map(s => s.id));
const skillByNorm = new Map(skills.map(s => [norm(s.name), s.id]));

// Skill modifiers — skill_modifiers.csv (1085 typed records; the engine's damage inputs).
const skillModifiers = table('skill_modifiers.csv').map(r => ({
  skillId: r.skill_id, name: r.name, category: r.category, level: num(r.level),
  type: r.mod_type, stat: r.target_stat, value: r.value, element: r.element,
}));
for (const m of skillModifiers)
  if (m.skillId && !skillIds.has(m.skillId))
    err(`skill_modifier "${m.name}" → skill_id "${m.skillId}" (no such skill)`);

// Relics / gems — flat/percent stat boosts + conditional effects (§4.16), some grant a skill.
const relics = table('relic.csv').map(r => ({
  id: r.relic_id, type: r.type, name: r.name, short: r.short_name,
  effect: r.effect, effectShort: r.effect_short, grantedSkill: r.granted_skill,
  unlockClass: r.unlock_class_id, source: r.source_method, availability: r.availability,
  sprite: r.sprite_path, param: parseParam(r.param),
  ...parseRelicStatMods(r.effect),
}));
const modeledRelics = relics.filter(r => r.effectModeled).length;
const classIds = new Set(classes.map(c => c.id));
for (const r of relics) {
  if (r.unlockClass && r.unlockClass !== '-' && !classIds.has(r.unlockClass))
    warn(`relic "${r.id}" → unlock_class_id "${r.unlockClass}" (no such class)`);
  if (r.grantedSkill && r.grantedSkill !== '-' && !skillByNorm.has(norm(r.grantedSkill)))
    warn(`relic "${r.id}" → granted_skill "${r.grantedSkill}" (unresolved to a skill)`);
}

// Enemies — targets for the damage sim; base stats code/extrapolated (§enemy tiers).
const enemies = table('enemy.csv').map(r => ({
  id: r.enemy_id, name: r.name, category: r.category, mechanics: r.category_mechanics,
  sprite: r.sprite_path, nEncounters: num(r.n_encounters), baseSource: r.base_source,
  base: { hp: num(r.hp), pow: num(r.power), foc: num(r.focus), tgh: num(r.toughness),
          dsc: num(r.discipline), spd: num(r.speed), agi: num(r.agility), end: num(r.endurance),
          wis: num(r.wisdom), tec: num(r.technique) },
}));

// Supporting reference tables (shipped for later features; light-touch).
const traits = table('trait.csv').map(r => ({ id: r.trait_id, name: r.name, short: r.short_name,
  type: r.type, rarity: num(r.rarity), negative: r.negative,
  levels: [r.level_1, r.level_2, r.level_3].filter(x => x && x !== '-'), param: parseParam(r.param) }));
const distortions = table('distortion.csv').map(r => ({ id: r.distortion_id, name: r.name, short: r.short_name,
  type: r.type, rarity: num(r.rarity), negative: r.negative,
  levels: [r.level_1, r.level_2, r.level_3].filter(x => x && x !== '-'), param: parseParam(r.param) }));
const glossary = table('glossary.csv').map(r => ({ category: r.category, term: r.term, definition: r.definition }));

// Per-character LEARNSET — learnset.csv (class_id → skills/fight/defend/traits), extracted
// from the compiled class descriptors (each skill field points to a per-skill class-object
// global written at load by that skill's boot; see _tbc_extract PROCEDURAL_MAP §4.17).
// Join keys: skills → skill.id (skill_master), traits → trait.id. Extract-borne, guarded
// by the dangling-ref checks below.
const traitIds = new Set(traits.map(t => t.id));
const splitIds = s => String(s || '').split(';').map(x => x.trim()).filter(Boolean);
const learnset = table('learnset.csv').map(r => ({
  classId: r.class_id, skills: splitIds(r.skills), fightSkills: splitIds(r.fight_skill),
  defendSkills: splitIds(r.defend_skill), traits: splitIds(r.traits),
}));
const learnByClass = new Map(learnset.map(l => [l.classId, l]));
let traitLinks = 0, traitUnresolved = 0;
for (const l of learnset) {
  if (!classIds.has(l.classId)) err(`learnset → class_id "${l.classId}" (no such class)`);
  for (const sid of [...l.skills, ...l.fightSkills, ...l.defendSkills])
    if (!skillIds.has(sid)) err(`learnset "${l.classId}" → skill "${sid}" (no such skill)`);
  // Traits are code-extracted (292); trait.csv is a smaller JSON-defined subset — attach the
  // ids regardless, and only summarise how many lack a rich trait.csv row (not per-trait spam).
  for (const tid of l.traits) { traitLinks++; if (!traitIds.has(tid)) traitUnresolved++; }
}
if (traitUnresolved) warn(`learnset: ${traitUnresolved}/${traitLinks} innate-trait links lack a trait.csv row (trait.csv is a partial extract)`);

// ── Apply metadata tags ──────────────────────────────────────────────────────
const { filters, validTags } = buildFilters(glossary);
for (const f of filters) f.icon = filterIcon(f);
checkAssets(filters, 'icon', 'filter', 'warn');     // tag icons in assets/tag/ (run tbc_extract_tag_icons.py)
const modsBySkill = new Map();
for (const m of skillModifiers) (modsBySkill.get(m.skillId) || modsBySkill.set(m.skillId, []).get(m.skillId)).push(m);
for (const s of skills) s.tags = tagSkill(s, modsBySkill.get(s.id) || [], validTags);
const skillTagsByNorm = new Map(skills.map(s => [norm(s.name), s.tags]));
for (const r of relics) r.tags = tagRelic(r, skillTagsByNorm, validTags);
// Character learnset + tags — attach each class's skills/traits and aggregate its tag set
// from the skills it can use (the learnset landed; the old stub is retired).
const skillById = new Map(skills.map(s => [s.id, s]));
for (const c of classes) {
  const l = learnByClass.get(c.id);
  c.skills = l ? l.skills : [];
  c.fightSkills = l ? l.fightSkills : [];
  c.defendSkills = l ? l.defendSkills : [];
  c.traitIds = l ? l.traits : [];
  const tags = new Set();
  for (const sid of c.skills) for (const t of (skillById.get(sid)?.tags || [])) tags.add(t);
  c.tags = [...tags];
}
const classesWithSkills = classes.filter(c => c.skills.length).length;
const skillsTagged = skills.filter(s => s.tags.length).length;
const relicsTagged = relics.filter(r => r.tags.length).length;
// Guardrail (belt-and-suspenders — tag functions already filter to the vocab): no dangling tags.
for (const s of skills) for (const t of s.tags) if (!validTags.has(t)) err(`skill "${s.id}" → unknown tag "${t}"`);
for (const r of relics) for (const t of r.tags) if (!validTags.has(t)) err(`relic "${r.id}" → unknown tag "${t}"`);

// ── Asset & id hygiene ──────────────────────────────────────────────────────
checkUniqueIds(classes, 'class');
checkUniqueIds(skills, 'skill');
checkUniqueIds(relics, 'relic');
checkUniqueIds(enemies, 'enemy');
checkAssets(classes, 'sprite', 'class', 'error');   // UI renders these now
checkAssets(relics, 'sprite', 'relic', 'error');    // equip UI will render these
checkAssets(enemies, 'sprite', 'enemy', 'warn');    // enemy sprites not shipped yet (roster-only)

// ── Report ──────────────────────────────────────────────────────────────────
const line = '─'.repeat(52);
console.log(`\n── Data hygiene report ${line.slice(0, 30)}`);
console.log(`✓ ${classes.length} classes · ${skills.length} skills · ${skillModifiers.length} modifiers · ` +
            `${relics.length} relics (${modeledRelics} stat-modeled, ${relics.length - modeledRelics} situational) · ` +
            `${enemies.length} enemies · ${assetsChecked} asset paths checked`);
console.log(`✓ ${filters.length} filters (${new Set(filters.map(f => f.dimension)).size} dimensions) · ` +
            `tagged ${skillsTagged}/${skills.length} skills, ${relicsTagged}/${relics.length} relics · ` +
            `learnset ${classesWithSkills}/${classes.length} classes (${learnset.reduce((n, l) => n + l.skills.length, 0)} skill links)`);
for (const c of classes) if (!c.skills.length) warn(`class "${c.id}" has no learnset skills`);
if (errors.length) { console.log(`✗ ${errors.length} error(s):`); errors.slice(0, 30).forEach(e => console.log(`    ${e}`)); if (errors.length > 30) console.log(`    …and ${errors.length - 30} more`); }
if (warnings.length) { console.log(`⚠ ${warnings.length} warning(s):`); warnings.slice(0, 15).forEach(w => console.log(`    ${w}`)); if (warnings.length > 15) console.log(`    …and ${warnings.length - 15} more`); }
console.log(line);

const fatal = errors.length + (STRICT ? warnings.length : 0);
if (fatal) { console.error(`BUILD FAILED: ${errors.length} error(s)${STRICT ? ` + ${warnings.length} warning(s) (--strict)` : ''} — data.js NOT rewritten.`); process.exit(1); }

// ── Serialize ───────────────────────────────────────────────────────────────
const data = { version: '0.9.2', builtAt: null,
  classes, skills, skillModifiers, relics, enemies, traits, distortions, glossary, filters };
writeFileSync(join(ROOT, 'data', 'data.js'),
  `// AUTO-GENERATED by tools/build-data.mjs — do not edit by hand.\nwindow.TBC_DATA = ${JSON.stringify(data)};\n`);
console.log(`data.js written${warnings.length ? ` (${warnings.length} warning(s) recorded — see Progress.md)` : ''}.\n`);
