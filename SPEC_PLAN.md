# Time Break Chronicles — Build Calculator · Spec Plan

## Purpose
A theorycrafting tool for TBC players: assemble a **6-character party** (positioning
matters), equip relics/gems + skills, and see **effective stats and expected skill
damage** against a chosen enemy — so you can rank best-in-slot equips before committing
in-game. The damage math is not guessed: it's the code-verified model in
`../_tbc_extract/CALC_SPEC.md`, implemented once in `engine.mjs`.

## Data model
Extract-borne (from `../_tbc_extract/reports/`), wired directly — see WIKI_CONTEXT.
- **Class** (`class.csv`) — `id, name, character, act, base{pow foc spd tgh dsc agi end wis tec}, sprite, version`. Base stats are **code-verified** (descriptor tier immediates → value table, §4.14). 106 rows.
- **Skill** (`skill_master.csv`) — `id, codename, name, short, category, levels[], param(coef[]), computation, modSummary`. 861 rows (full code range, not the 342-file manifest).
- **SkillModifier** (`skill_modifiers.csv`) — one row per `(skill, level, effect)`: `type(damage|status|heal|stat_mod|summon|grant|stat_gain), stat, value, element`. 1085 rows — the engine's damage inputs.
- **Relic/gem** (`relic.csv`) — `id, type, name, effect, param(coef[]), grantedSkill, unlockClass, sprite`. Conditional "up to X" = `clamp(coef×condition, 0, cap)` (§4.16). 247 rows.
- **Enemy** (`enemy.csv`) — `id, name, category, mechanics, base{9 + hp}, baseSource(code|extrapolated)`. Damage-sim targets. 144 rows.
- **Trait / Distortion / Glossary** — shipped for later features.
- **Learnset** (`learnset.csv`) — per-class skill kit: `class.skills` + `fightSkills`/`defendSkills`/`traitIds`. 106 classes, 500 skill links (skill_id join). The class→skills link (was the unsolved datamine layer).
- **Filter / metadata vocabulary** (`filters`, derived from the glossary) — 61 filters across 5 dimensions (attribute, damage_type, skill_type, enemy_type, status); each `{tag, dimension, key, label, token, definition, icon}`. Tags are namespaced `<dimension>:<key>`; each carries an **`icon`** (`assets/tag/…`, extracted from `battle_icons.png`). `skill.tags` + `relic.tags` reference these; **`class.tags` aggregates from the class's own skills** (via the learnset).
- **Relationships:** a relic may grant a skill and/or unlock for a class; a skill has N modifier rows across levels (cumulative upgrades, not a scaling ladder); enemies resist by damage type via Toughness/Discipline (see engine `DAMAGE_TYPE_RESIST`); entities cross-reference the shared `filters` vocabulary via `tags`.

## Combat engine (`engine.mjs`) — the CALC_SPEC pipeline
`base → effectiveStat → raw(Σ coef×stat) → mitigation(×(1−resist%)) → crit(×1.35) → round`.
Confirmed-from-code: effective-stat stacking (`clamp(base×add×mult, 0.15×, 2×base)`, buffs
additive / reductions multiplicative), crit/hit contest `clamp((Tec−Agi)/(Tec+Agi)+0.05, .01,.99)`,
crit ×1.35 + round-half-up. Empirical (reproduces the sheet): resist curve, hp/mp.
Pure functions; imported by both `app.js` (browser) and `tools/test.mjs` (Node) so they can't drift.

## Architecture
- Stack: vanilla HTML/CSS/JS, **mobile-first**. Data compiled to `window.TBC_DATA` (see WIKI_CONTEXT).
- Data flow: `data/references/*.csv` → `tools/build-data.mjs` (+ hygiene guardrails) → `data/data.js` → `app.js`.
- Shared math: `engine.mjs` (ESM), used by app + tests. `app.js` is `<script type="module">`.
- Persistence: `localStorage` under `tbc.*` (e.g. `tbc.team`).
- Quality gates (replaces the old manual golden/hardening model — see `[[feedback_tbc_golden_workflow]]`):
  1. `build-data.mjs` **hygiene report** — dangling refs, 404 assets, dup ids; fails the build on errors.
  2. `tools/test.mjs` **regression tests** — pin CALC_SPEC worked examples + data.js integrity.

## Feature plan (prioritized)
### P0 — foundations (session 14 — DONE)
- [x] Extract-borne data backend wired (`skill_master`, `skill_modifiers`, `enemy`, `relic`, …) → `window.TBC_DATA`.
- [x] `engine.mjs` — full CALC_SPEC damage/stat math, shared by app + tests.
- [x] `build-data.mjs` data-hygiene guardrails (report + fail-on-error, `--strict`).
- [x] `tools/test.mjs` — 32 engine + data-integrity assertions.
- [x] Existing MVP (6-slot formation, class picker, derived readout) re-pointed to the engine.

### P1 — core value
- [x] **Relic/gem equip system** — N slots per character (gem_box UI), relic selector overlay, persistence v2. *(session 14)*
- [x] **Effective-stat panel** — equipped relics → effective stats via `engine.computeEffective`, base→effective deltas, derived recompute. Browser-verified. *(session 14)*
- [ ] **Skill loadout** — per-character skill slots (ungated until learnsets solved); passive-skill `stat_mod`/`stat_gain` → Step-1 stack.
- [ ] **Damage readout** — pick a skill + target enemy → expected damage / DoT (engine `skillModifierDamage`).
- [ ] **Best-in-slot** — rank candidate relics for a character+skill by expected damage.
- [x] **Metadata / filter tags** — glossary-derived `filters` vocabulary (61, 5 dims); `skill.tags` + `relic.tags`. *(session 14)*
- [x] **Learnset + character tags** — `learnset.csv` wired (`class.skills`/`fightSkills`/`defendSkills`/`traitIds`); `class.tags` aggregates from each class's skills (105/106 tagged). *(session 15)*
- [ ] Town/building boosts + boss-badge count → base stat boosts (fold into `base` per §1).

### P2 — nice-to-have
- [~] **Filter UI + detail panels** — tag chips (icon + label) render on the character readout + equipped relics (`tagChip()`); chips carry `data-tag`/`data-dim`. **Next:** make chips clickable → filter the relic/skill selectors + traverse to related entities (detail/info panels). **This feature carries the overlay-architecture alignment** (per the session-17 audit): build it on the house two-root overlays (`#overlay-root` z100 + `#detail-overlay-root` z200), event delegation (one handler/root + `data-action`), and Confirm/pending selection semantics — see `.claude/skills/build-calc-planner/references/ui-conventions.md`.
- [ ] Adjacency / targeting reach by position; formation visualization.
- [ ] Distortion (run-modifier) picker; trait system; glossary/tooltips surfacing the stat system.
- [ ] Save/load/share builds (URL/code); enemy sprites when extracted; multi-form (Claire) switcher.

## Open questions
- Exact adjacency/targeting rules per position (front/back reach) — confirm from game.
- Enemy HP formula (currently blank; player hp is empirical) — needed for TTK, not for damage ranking.
- Where resistance enters for elemental skills (physical path has none) — decompile an elemental skill.
- RNG damage spread (deferred — use expected value; doesn't affect ranking).
