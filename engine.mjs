// TBC combat engine — the single source of the damage/stat math.
// Implemented directly from _tbc_extract/CALC_SPEC.md (code-verified, session 13).
// Pure functions, no DOM: imported by both the browser app (app.js) and the
// Node regression tests (tools/test.mjs) so the two can never drift.
//
// Confidence tags mirror CALC_SPEC:
//   [confirmed] decompiled from the binary   [empirical] fit to the stat sheet.

export const STAT_KEYS = ['pow', 'foc', 'spd', 'tgh', 'dsc', 'agi', 'end', 'wis', 'tec'];

// Maps a skill's stat name (as it appears in skill_modifiers.target_stat) to the base key.
export const STAT_NAME_TO_KEY = {
  power: 'pow', focus: 'foc', speed: 'spd', toughness: 'tgh', discipline: 'dsc',
  agility: 'agi', endurance: 'end', wisdom: 'wis', technique: 'tec',
};

// ── Derived display stats (Step 3 curve inputs) ─────────────────────────────
// [empirical] reproduces the in-game stat sheet 103/103; literal constants are
// not in the exe (curve computed in a vtable getter) but this matches the shown %.
export const RESIST = { A: 155.4, K: 206.6, C: 3.4 };
export const resist = s => Math.max(0, Math.round(RESIST.A * s / (s + RESIST.K) - RESIST.C));

// [empirical] hp = round(6.543·END + 165); mp = round(4·WIS + 5)
export function deriveStats(base) {
  const tghPct = resist(base.tgh);
  const dscPct = resist(base.dsc);
  return {
    hp: Math.round(6.543 * base.end + 165),
    mp: Math.round(4 * base.wis + 5),
    tghPct, dscPct,
    elePct: Math.round((tghPct + dscPct) / 2),   // [confirmed] elemental = avg(TGH,DSC)
  };
}

// ── Step 1: effective stat ──────────────────────────────────────────────────
// [confirmed §4.11] fold each modifier m (a multiplier: 1.5 = "+50%", 0.8 = "−20%")
// by magnitude — buffs (m>1) stack ADDITIVELY, reductions (m≤1) MULTIPLICATIVELY —
// then effective = base × add × mult × context, clamped to [0.15×base, 2×base].
export const STAT_CLAMP = { lo: 0.15, hi: 2 };
export function effectiveStat(base, mods = [], contextMult = 1) {
  let add = 1, mult = 1;
  for (const m of mods) {
    if (m <= 1) mult *= m;
    else add += (m - 1);
  }
  const eff = base * add * mult * contextMult;
  return Math.min(Math.max(eff, STAT_CLAMP.lo * base), STAT_CLAMP.hi * base);
}

// Compute every effective stat for a character given per-stat modifier lists.
// mods = { pow: [1.5, 0.8], tec: [...], ... } (missing keys → no modifiers).
export function effectiveStats(base, mods = {}, contextMult = 1) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = effectiveStat(base[k], mods[k] || [], contextMult);
  return out;
}

// Fold equipped relics into a character's effective stats.
// relics: [{ statMods:[{stat,flat,pct}], scaleMods:[{stat,fromStat,coef}] }] (from build-data).
// Modeling choice: flat boosts + stat-scaling fold into base (the clamp reference, like town
// boosts §1); percent boosts are the modifiers `m` (buffs additive / reductions multiplicative).
// scaleMods read the *base* fromStat to avoid circular effective-stat dependencies.
export function computeEffective(classBase, relics = [], contextMult = 1) {
  const effBase = { ...classBase };
  const mults = {};                                  // stat key -> [multiplier,…]
  for (const r of relics) {
    for (const m of r.statMods || []) {
      if (m.flat) effBase[m.stat] = (effBase[m.stat] || 0) + m.flat;
      if (m.pct) (mults[m.stat] ??= []).push(1 + m.pct / 100);
    }
    for (const s of r.scaleMods || [])
      effBase[s.stat] = (effBase[s.stat] || 0) + s.coef * (classBase[s.fromStat] || 0);
  }
  const effective = {};
  for (const k of STAT_KEYS) effective[k] = effectiveStat(effBase[k], mults[k] || [], contextMult);
  return { effBase, effective, derived: deriveStats(effective) };
}

// ── Step 3: mitigation by damage type ───────────────────────────────────────
// [confirmed, glossary] which stat resists which damage type.
export const DAMAGE_TYPE_RESIST = {
  Physical: 'tgh', Poison: 'tgh', Sonic: 'tgh', Stun: 'tgh',
  Holy: 'dsc', Dark: 'dsc', Energy: 'dsc',
  Fire: 'ele', Ice: 'ele', Lightning: 'ele',
  // Sleep is resisted by Wisdom but is not HP damage; handled by callers.
};
// Returns the resist % (0–100) the target applies to a damage type. `derived` from deriveStats.
export function damageTypeResistPct(damageType, derived) {
  const which = DAMAGE_TYPE_RESIST[damageType];
  if (which === 'tgh') return derived.tghPct;
  if (which === 'dsc') return derived.dscPct;
  if (which === 'ele') return derived.elePct;
  return 0;                                    // unknown / untyped / non-mitigable
}
export const mitigate = (raw, resistPct) => raw * (1 - resistPct / 100);

// ── Step 4: crit / hit contest, then round ──────────────────────────────────
// [confirmed §4.8/decompiled BattleAI + patch note] generic opposed-stat contest:
//   chance = clamp((A − D)/(A + D) + baseRate, 0.01, 0.99)
export const CRIT_MULT = 1.35;
export const BASE_CRIT = 0.05;                 // patch-note confirmed (5% floor)
export const CONTEST_CLAMP = { lo: 0.01, hi: 0.99 };
export function contest(a, d, baseRate = BASE_CRIT) {
  if (a + d === 0) return Math.min(Math.max(baseRate, CONTEST_CLAMP.lo), CONTEST_CLAMP.hi);
  const c = (a - d) / (a + d) + baseRate;
  return Math.min(Math.max(c, CONTEST_CLAMP.lo), CONTEST_CLAMP.hi);
}
// Attacker Technique vs defender Agility → crit chance (same direction as hit).
export const critChance = (tecAtt, agiDef) => contest(tecAtt, agiDef, BASE_CRIT);
// Attacker Technique vs defender Agility → hit chance; dodge = 1 − hit.
export const hitChance = (tecAtt, agiDef) => contest(tecAtt, agiDef, BASE_CRIT);

// Per-hit final damage: crit applied last, round-half-up. [confirmed §4.8]
export const finalHit = (mitigated, didCrit) =>
  Math.floor((didCrit ? CRIT_MULT : 1) * mitigated + 0.5);
// Expected (average) damage for DPS/ranking: mitigated × (1 + 0.35·critChance).
export const expectedDamage = (mitigated, crit) => mitigated * (1 + (CRIT_MULT - 1) * crit);

// ── Composite: expected damage of one skill modifier row ────────────────────
// row: { coef, stat ('pow'|…), damageType }.  ctx: { casterEff, targetDerived, tecAtt, agiDef }.
// Returns { raw, mitigated, crit, expected }.
export function skillModifierDamage(row, ctx) {
  const stat = ctx.casterEff[row.stat] ?? 0;
  const raw = row.coef * stat;
  const resistPct = damageTypeResistPct(row.damageType, ctx.targetDerived);
  const mitigated = mitigate(raw, resistPct);
  const crit = critChance(ctx.tecAtt, ctx.agiDef);
  return { raw, mitigated, crit, expected: expectedDamage(mitigated, crit) };
}

// Parse a param cell like "[0.8]" or "[0.1;0.2;1.35]" → number[].
export function parseParam(cell) {
  if (!cell || cell === '-') return [];
  return String(cell).replace(/[[\]]/g, '').split(';')
    .map(x => Number(x.trim())).filter(Number.isFinite);
}
