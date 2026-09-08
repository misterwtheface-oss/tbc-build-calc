// Functional / regression tests (vanilla Node, no deps). Run: `node tools/test.mjs`
//
// Two suites guard the pivot to an extract-borne backend:
//   ENGINE — pins CALC_SPEC worked examples so the damage math can't silently drift.
//   DATA   — smoke-checks the generated data.js so a bad build is caught before ship.
// Exit non-zero on any failure (wire into CI / pre-push).
import * as E from '../engine.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function ok(name, cond, got, want) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${name}` + (want !== undefined ? `  (got ${got}, want ${want})` : '')); }
}
const eq = (name, got, want) => ok(name, got === want, got, want);
const near = (name, got, want, eps) => ok(name, approx(got, want, eps), got, want);

console.log('ENGINE — CALC_SPEC parity');
// Step 1: effective-stat stacking (buffs additive, reductions multiplicative, clamp).
near('stack +50% & +30% & ×0.8 on 100 → 144', E.effectiveStat(100, [1.5, 1.3, 0.8]), 144);
near('buffs additive: +50% & +30% on 100 → 180', E.effectiveStat(100, [1.5, 1.3]), 180);
near('reductions multiply: ×0.8 & ×0.7 on 100 → 56', E.effectiveStat(100, [0.8, 0.7]), 56);
near('upper clamp: ×3 on 100 → 200 (2×base)', E.effectiveStat(100, [3.0]), 200);
near('lower clamp: ×0.1 on 100 → 15 (0.15×base)', E.effectiveStat(100, [0.1]), 15);
near('no mods → base', E.effectiveStat(131, []), 131);

// Step 4: crit / hit contest + rounding.
near('crit at parity (Tec=Agi=100) → 0.05', E.critChance(100, 100), 0.05);
near('crit Tec150 vs Agi50 → 0.55', E.critChance(150, 50), 0.55);
near('crit clamps to 0.99', E.critChance(1000, 1), 0.99);
near('crit clamps to 0.01 (huge Agi)', E.critChance(1, 1000), 0.01);
eq('finalHit crit: 1.35×40 +0.5 → 54', E.finalHit(40, true), 54);
eq('finalHit non-crit: 40 → 40', E.finalHit(40, false), 40);
near('expectedDamage 40 @5% crit → 40.7', E.expectedDamage(40, 0.05), 40.7);

// Step 3: resist curve + derived (empirical, reproduces sheet).
eq('resist(101) → 48', E.resist(101), 48);
eq('resist(0) → 0 (clamped ≥0)', E.resist(0), 0);
{
  const d = E.deriveStats({ tgh: 131, dsc: 70, end: 101, wis: 70 });
  eq('hp = round(6.543·101+165) → 826', d.hp, 826);
  eq('mp = round(4·70+5) → 285', d.mp, 285);
  eq('elePct = round((tgh%+dsc%)/2)', d.elePct, Math.round((E.resist(131) + E.resist(70)) / 2));
}

// Step 2+3+4: one skill modifier row end-to-end (Burning Fist-style, single Physical term).
{
  const casterEff = E.effectiveStats(
    { pow: 100, foc: 0, spd: 0, tgh: 0, dsc: 0, agi: 0, end: 0, wis: 0, tec: 100 });
  const targetDerived = E.deriveStats({ tgh: 101, dsc: 50, end: 0, wis: 0 }); // tgh% used
  const r = E.skillModifierDamage(
    { coef: 0.8, stat: 'pow', damageType: 'Physical' },
    { casterEff, targetDerived, tecAtt: 100, agiDef: 100 });
  near('raw = 0.8 × effPower(100) → 80', r.raw, 80);
  near('mitigated = 80 × (1 − tgh%/100)', r.mitigated, 80 * (1 - targetDerived.tghPct / 100));
  near('crit at parity → 0.05', r.crit, 0.05);
  near('expected = mitigated × 1.0175', r.expected, r.mitigated * 1.0175);
}

// computeEffective: relic stat-mod integration (flat folds into base, pct as modifier, scale from base).
{
  const base = { pow: 100, foc: 100, spd: 100, tgh: 100, dsc: 100, agi: 100, end: 100, wis: 100, tec: 100 };
  const gem = { statMods: [{ stat: 'pow', flat: 5, pct: 15 }], scaleMods: [] };  // Ares-like
  const r = E.computeEffective(base, [gem]);
  near('flat folds into base: effBase.pow → 105', r.effBase.pow, 105);
  near('then +15%: effective.pow → 120.75', r.effective.pow, 120.75);
  near('unmodified stat unchanged', r.effective.foc, 100);
  const dec = { statMods: [{ stat: 'agi', flat: 0, pct: -10 }], scaleMods: [] };  // Diana-like penalty
  near('−10% reduction: effective.agi → 90', E.computeEffective(base, [dec]).effective.agi, 90);
  const scale = { statMods: [], scaleMods: [{ stat: 'tec', fromStat: 'foc', coef: 0.5 }] }; // ArcaneVision-like
  near('scale +0.5×Focus into base: effBase.tec → 150', E.computeEffective(base, [scale]).effBase.tec, 150);
  near('derived recomputes from effective', E.computeEffective(base, [gem]).derived.hp, E.deriveStats(r.effective).hp);
}

// parseParam
eq('parseParam "[0.8]" length', E.parseParam('[0.8]').length, 1);
eq('parseParam "-" → empty', E.parseParam('-').length, 0);
near('parseParam "[0.1;0.2;1.35]"[2]', E.parseParam('[0.1;0.2;1.35]')[2], 1.35);

console.log(`\nDATA — generated data.js integrity`);
const dataPath = join(ROOT, 'data', 'data.js');
if (!existsSync(dataPath)) {
  fail++; console.log('  ✗ data.js not built — run `node tools/build-data.mjs` first');
} else {
  const sandbox = { window: {} };
  new Function('window', readFileSync(dataPath, 'utf8'))(sandbox.window);
  const D = sandbox.window.TBC_DATA;
  ok('data.js sets window.TBC_DATA', !!D);
  ok('has 106 classes', D.classes.length === 106, D.classes.length, 106);
  ok('has skills', D.skills.length > 800, D.skills.length);
  ok('has skillModifiers', D.skillModifiers.length > 1000, D.skillModifiers.length);
  ok('every class base is fully numeric',
    D.classes.every(c => E.STAT_KEYS.every(k => Number.isFinite(c.base[k]))));
  // engine ⇄ data smoke: derive stats for a real class without throwing.
  const zeke = D.classes.find(c => /wrestler|zeke/i.test(c.id + c.character));
  if (zeke) ok('derive real class stats', E.deriveStats(zeke.base).hp > 0, E.deriveStats(zeke.base).hp);
  // every skill_modifier resolves to a skill (integrity mirror of the build guardrail).
  const ids = new Set(D.skills.map(s => s.id));
  ok('every skillModifier resolves to a skill',
    D.skillModifiers.every(m => !m.skillId || ids.has(m.skillId)));
  // relic stat-mod parser landed in data.js
  const modeled = D.relics.filter(r => r.effectModeled).length;
  ok('≥40 relics stat-modeled', modeled >= 40, modeled);
  const ares = D.relics.find(r => r.id === 'Ares');
  if (ares) {
    ok('Ares parsed to pow+tgh statMods', ares.statMods.length === 2 &&
      ares.statMods.every(m => (m.stat === 'pow' || m.stat === 'tgh') && m.flat === 5 && m.pct === 15));
  }
  const zeus = D.relics.find(r => r.id === 'Zeus');   // "all attributes"
  if (zeus) ok('Zeus (all attributes) → 9 statMods', zeus.statMods.length === 9, zeus.statMods.length);
  // full pipeline against real data (pins the browser-verified Physicist + Ares + Zeus build).
  const genius = D.classes.find(c => c.id === 'genius');
  if (genius && ares && zeus) {
    const r = E.computeEffective(genius.base, [ares, zeus]);
    eq('Physicist+Ares+Zeus: effective POW → 96', Math.round(r.effective.pow), 96);
    eq('Physicist+Zeus: effective WIS → 143', Math.round(r.effective.wis), 143);
    eq('…derived HP → 756', r.derived.hp, 756);
    eq('…derived MP → 576', r.derived.mp, 576);
    eq('…TGH% → 50', r.derived.tghPct, 50);
  }

  // ── metadata: filter vocabulary + entity tags ──
  ok('filters vocabulary present', Array.isArray(D.filters) && D.filters.length >= 55, D.filters?.length);
  const dims = new Set((D.filters || []).map(f => f.dimension));
  ok('5 filter dimensions', dims.size === 5 && ['attribute','damage_type','skill_type','enemy_type','status'].every(d => dims.has(d)), [...dims].join(','));
  const tagSet = new Set((D.filters || []).map(f => f.tag));
  for (const t of ['damage_type:Fire', 'skill_type:Ranged', 'attribute:pow', 'status:Buff', 'enemy_type:beast'])
    ok(`vocab has ${t}`, tagSet.has(t));
  // no dangling tags anywhere (the core guardrail)
  ok('no dangling skill tags', D.skills.every(s => (s.tags||[]).every(t => tagSet.has(t))));
  ok('no dangling relic tags', D.relics.every(r => (r.tags||[]).every(t => tagSet.has(t))));
  // every filter maps to an icon that exists on disk (the tag→icon mapping)
  ok('every filter has an assets/tag icon', D.filters.every(f => f.icon && f.icon.startsWith('assets/tag/')),
     D.filters.filter(f => !f.icon).map(f => f.tag).join(','));
  ok('every filter icon file exists', D.filters.every(f => existsSync(join(ROOT, f.icon))),
     D.filters.filter(f => !existsSync(join(ROOT, f.icon))).map(f => f.icon).join(','));
  const iconOf = t => D.filters.find(f => f.tag === t)?.icon;
  eq('attribute:pow → ei_power_up', iconOf('attribute:pow'), 'assets/tag/ei_power_up.png');
  eq('skill_type:Summon → si_summon', iconOf('skill_type:Summon'), 'assets/tag/si_summon.png');
  eq('damage_type:Fire → ei_fire', iconOf('damage_type:Fire'), 'assets/tag/ei_fire.png');
  eq('status:Resist → ei_resist', iconOf('status:Resist'), 'assets/tag/ei_resist.png');
  eq('enemy_type:beast → beast', iconOf('enemy_type:beast'), 'assets/tag/beast.png');
  // known taggings
  const bash = D.skills.find(s => s.id === 'bash');
  if (bash) ok('Bash tagged Physical + Stun', bash.tags.includes('damage_type:Physical') && bash.tags.includes('skill_type:Stun'), bash.tags.join(','));
  const aresR = D.relics.find(r => r.id === 'Ares');
  if (aresR) ok('Ares tagged attribute:pow + attribute:tgh', aresR.tags.includes('attribute:pow') && aresR.tags.includes('attribute:tgh'));
  const ogs = D.relics.find(r => r.id === 'OgsSpear');
  if (ogs) ok('Og\'s Spear tagged skill_type:Ranged', ogs.tags.includes('skill_type:Ranged'), ogs.tags.join(','));
  // coverage + character learnset
  ok('≥400 skills tagged', D.skills.filter(s => s.tags.length).length >= 400, D.skills.filter(s => s.tags.length).length);
  ok('≥150 relics tagged', D.relics.filter(r => r.tags.length).length >= 150, D.relics.filter(r => r.tags.length).length);
  // learnset landed: every class has skills, all referencing real skill ids, and tags aggregate from them
  const skillIds = new Set(D.skills.map(s => s.id));
  ok('all 106 classes have learnset skills', D.classes.every(c => Array.isArray(c.skills) && c.skills.length > 0),
     D.classes.filter(c => !c.skills?.length).map(c => c.id).join(','));
  ok('learnset skill ids all resolve', D.classes.every(c => c.skills.every(s => skillIds.has(s))));
  // tags aggregate from a class's skills; ≥100/106 non-empty (a few utility-only kits carry no tags)
  ok('character tags aggregate from skills', D.classes.filter(c => c.tags.length > 0).length >= 100,
     D.classes.filter(c => !c.tags.length).map(c => c.id).join(','));
  const wr = D.classes.find(c => c.id === 'wrestler');
  ok('wrestler learnset = clothesline/dropkick/finisher/pander/shakeoff/taunt',
     wr && ['clothesline', 'dropkick', 'finisher', 'pander', 'shakeoff', 'taunt'].every(s => wr.skills.includes(s)),
     wr && wr.skills.join(','));
}

console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
