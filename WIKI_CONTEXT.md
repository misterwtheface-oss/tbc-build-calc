# Time Break Chronicles — Wiki / Context Tree

LLM-oriented context for a future session. Read this to understand the game, the data,
and the datamine pipeline without re-deriving anything.

## Game basics
Time Break Chronicles (Steam `1393500`) — a party RPG. You recruit **classes** (each a
named character, e.g. Wrestler = "Zeke"), form a **6-slot party where positioning matters**
(front line left / back line right — F1/B1/F2/B2/F3/B3), and equip **relics/gems** + **skills**
+ **traits**. Progression: class quests unlock relics; a town with **buildings** grants global
stat boosts; **distortions** are run modifiers. This calculator models the combat math so
players can rank equips.

## Key mechanics (for the calculator) — the non-obvious rules
- **9 base stats:** pow, foc, spd, tgh (toughness), dsc (discipline), agi, end, wis, tec.
  Base is **code-verified** (a per-class descriptor stores small integer *tiers*; a hand-authored
  tier→value table maps them, §4.14). Not RNG, not level-scaled — flat per class.
- **Effective ≠ base.** `getStat` folds modifiers on every read: **buffs (m>1) stack additively**
  (+50% & +30% = ×1.80), **reductions (m≤1) stack multiplicatively** (×0.8 & ×0.7 = ×0.56), then
  `base × add × mult`, **clamped to [0.15×base, 2×base]** (the glossary "Attribute Caps"). Town/
  building boosts fold into *base* first; equip/passive %s are the modifiers.
- **Damage** = `Σ coefficient × effectiveStat` (a skill can scale off >1 stat). Coefficients are
  per-skill constants (`param`); conditionality (e.g. "×1.5 vs a stunned target") is *code, not data*.
- **Skill levels are cumulative upgrades, not a scaling ladder** — apply the highest-unlocked
  coefficient; each level row is a distinct effect (see Burning Fist in CALC_SPEC §6).
- **Mitigation:** Toughness resists Physical/Poison/Sonic/Stun; Discipline resists Holy/Dark/Energy;
  elemental (Fire/Ice/Lightning) = **average** of the two resists. Agility = evasion + anti-crit (not resist).
- **Crit / hit = an opposed-stat contest:** `clamp((Tec_att − Agi_def)/(Tec_att + Agi_def) + 0.05, 0.01, 0.99)`.
  Crit multiplier **×1.35**, applied last, round-half-up. Base crit **0.05** (patch-note confirmed).
- **Relic "up to X" is never RNG** — it's `clamp(coef × liveCondition, 0, cap)` where cap = the "up to"
  number; condition = current/missing HP%·MP%, debuff count, per-event stacks, etc. (§4.16).
- **EOF gotcha:** `class.csv` ships without a trailing newline → `wc -l` reports 105 for 106 rows.
  The parser tolerates it; don't "fix" by chasing a phantom missing row.

## Data sources & datamine access
- **Datamine workspace:** `../_tbc_extract/` (sibling, **NOT shipped** — outside this repo).
  Root entry point: `_tbc_extract/CONTEXT_MAP.md`. Combat spec: `_tbc_extract/CALC_SPEC.md`
  (the implementable formula chain, code-verified). Procedural detail: `code/PROCEDURAL_MAP.md`.
- **How to (re)generate the shipped data** (extracts live in `_tbc_extract/reports/`):
  - Base stats: `python tbc_extract_base_tiers.py` + `tbc_build_base_from_tiers.py` → `base_from_code.csv` (feeds `class.csv`).
  - Skills: `tbc_build_skill_master.py` → `skill_master.csv` + `skill_modifiers.csv`.
  - Enemies: `tbc_extract_enemy_base.py` + `tbc_fill_enemy_stats.py` → `enemy.csv`.
  - Relics/traits/distortions/glossary/buildings: see `_tbc_extract` scripts (`tbc_re_strings.py`, `tbc_link.py`, …).
  - Icons: `tbc_extract_gem_icons.py <atlas.png> <outdir>` → `assets/relic/`, `assets/item/`.
- **Source → ship mapping** (what this repo's `data/references/*.csv` came from):
  `_tbc_extract/reports/{skill_master,skill_modifiers}.csv` → `data/references/` (copied in, session 14).
  `class.csv`, `relic.csv`, `enemy.csv`, `trait.csv`, `distortion.csv`, `glossary.csv` already staged from prior sessions.
- **If refreshing:** re-copy the CSVs from `_tbc_extract/reports/` into `data/references/`, then
  `node tools/build-data.mjs` (hygiene report must pass) and `node tools/test.mjs`.

## What ships vs. what is gitignored
- **SHIPPED (tracked):** `data/references/*.csv` (the extract subset), `data/data.js` (generated —
  Pages serves it), `assets/class/*`, `assets/relic/*`, `assets/item/*`, `assets/tag/*`, `engine.mjs`, `app.js`,
  `index.html`, `style.css`, `tools/*`, `SPEC_PLAN.md`, `WIKI_CONTEXT.md`.
- **GITIGNORED / not shipped:** the entire `../_tbc_extract/` datamine (raw dumps, decompiled source,
  Ghidra project, `.md` formula maps), `Progress.md` (local-only backlog), a couple of unassigned relic
  icons (`assets/relic/{frozen_heart,empty}.png`). Rule: if the SPA doesn't load it at runtime, it doesn't belong here.

## Data status — extract-borne, not hand-verified
Per the **session-14 pivot** (`[[feedback_tbc_golden_workflow]]`): the reference CSVs are the
**code-verified datamine extracts**, wired directly (no manual golden curation / checksum gate).
Base stats and skill coefficients are code-derived and high-confidence; the **resist/hp/mp curves are
empirical** (reproduce the in-game sheet but literal constants aren't in the binary); a handful of
skill/trait text rows are code-only best-effort. Correctness is guarded by `build-data.mjs` hygiene
+ `tools/test.mjs` regression, not by hand-annotation.

## Metadata / filter tags
The **glossary is the filter vocabulary source** — it embeds machine-readable tokens
(`SkillType.Fire`, `EffectIcon.power_up`, `Sprite.beast`). `build-data.mjs` derives one canonical
`TBC_DATA.filters` list (61 filters, 5 dimensions: attribute · damage_type · skill_type · enemy_type ·
status), each `{tag, dimension, key, label, token, definition}`. Entities carry `tags` referencing
these (namespaced `<dimension>:<key>`):
- **`skill.tags`** — damage type from modifier `element`; skill-type/damage tokens from text; mechanic→
  glossary (heal→Healing, summon→Summon, stat_mod→Buff+attribute, status→Debuff [heuristic]).
- **`relic.tags`** — attributes from parsed statMods; `SkillType.*` tokens in effect; Resist; + the tags
  of any skill it grants.
- **`class.tags`** — aggregated from the character's own skills. The per-character **learnset** (long the
  one unsolved datamine layer) is now solved (`_tbc_extract` §4.17) and shipped as `learnset.csv`; each
  class carries `skills`/`fightSkills`/`defendSkills`/`traitIds`, and `class.tags` = the union of its
  skills' tags. **105/106 classes tagged** (only `vampire`/Edgard is empty — its 5 skills are code-only
  with no recovered text/modifiers, so no signal to tag from).
Guardrail: tags are filtered to the vocabulary at source, plus a no-dangling-tag hygiene check; every
learnset `skill_id` must resolve to a skill (0 errors).

**Tag icons.** Each filter carries an **`icon`** (`assets/tag/<frame>.png`) so the SPA can render tag
chips. Icons come from the game's `battle_icons.png` atlas via `_tbc_extract/tbc_extract_tag_icons.py`
(re-run to refresh). Frame-name convention (kept in sync between the extractor's `NEEDED` set and
`build-data.mjs` `filterIcon()`): `EffectIcon.*` → `ei_*` (damage types, `ei_<attr>_up`, `ei_resist`);
`SkillType.*` → `si_*` (all 27 skill types); enemy `Sprite.*` → plain (`beast.png`). The SPA's
`tagChip()` (app.js) renders `{icon,label}` with `data-tag`/`data-dim` hooks for future filtering.

## Data model reference
See `SPEC_PLAN.md` → "Data model" for the field-by-field shape the build pipeline expects, and
`engine.mjs` for the exact math (constants tagged `[confirmed]` / `[empirical]`).
