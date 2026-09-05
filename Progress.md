# TBC Team Builder — Progress & Backlog

Living log for the Time Break Chronicles team-builder calculator.
Live: https://misterwtheface-oss.github.io/tbc-build-calc/ · Repo: misterwtheface-oss/tbc-build-calc

Conventions: **mobile-first**, vanilla-JS SPA, overlay-driven selectors, mirror the game UI.
Data flows `data/references/*.csv` → `tools/build-data.mjs` → `data/data.js` (`window.TBC`).

---

## ✅ Shipped

- **Session 1 (MVP):**
  - Data pipeline: CSV references → `data.js` (106 classes, 247 relics, 238 skills, 115 traits, 126 distortions, 53 glossary)
  - 6-position formation grid — front line (left) / back line (right), slots F1/B1/F2/B2/F3/B3
  - Class-selector overlay — all 106 classes with sprites, search by class/character
  - Selected-character readout — base attributes + live derived stats (HP, MP, TGH%/DSC%/ELE%)
  - Remove / clear team, localStorage persistence
  - Deployed to GitHub Pages (main root, `.nojekyll`)

---

## 🔜 Next up (near-term)

- [ ] **Equip system** — relic/gem slots + skill loadout + traits per character (overlay selectors; data already present)
- [ ] **Modifier math** — apply relic/gem/skill-passive/building stat boosts to base → effective stats (formulas in `_tbc_extract/reports/stat_formulas.md`; building boosts in `building_stat_boosts.csv`)
- [ ] **Real game-UI skin** — replace CSS panels with `custom_ui` 9-slice container assets to mirror the game
- [ ] **Adjacency / targeting** — encode front/back reach + adjacency so effects show valid targets by position

---

## 📋 Backlog

### Features
- [ ] Skill detail overlay (per-level effects, damage: multiplier/stat/element/target/uses)
- [ ] Relic/gem detail overlay (effect, granted skill, unlock class); relics-shared-across-team model
- [ ] Distortion (run modifier) picker + effect on the team
- [ ] Town/building upgrade toggles + boss-badge count → global stat boosts
- [ ] Damage simulation (player skills × stats vs enemy defenses)
- [ ] Save/load/share team builds (URL or code), like vs-build-calc loadouts
- [ ] Glossary/tooltips surfacing the stat & damage-type system

### Data / extraction (see `_tbc_extract/`)
- [ ] **Finish base stats** — 23 rows still `0.6.14`; need active-party (skills-page) memory dumps → `tbc_dump_stats.py`
- [ ] Validate the 6 flagged base-stat diffs vs Sheets backup (knight/doctor/jaguar/diva/rune_scribe/judge)
- [ ] Status/effect icons (user extracting) → wire into UI
- [ ] Compiled numeric params already merged into skill/relic/trait/distortion csvs (`coefficients`, `int_params`)
- [ ] Enemy data for damage sim (`enemy.csv` roster; stats compiled/manual)

### UI / polish
- [ ] Class-select: group by source act / character; show mini stat preview on hover
- [ ] Formation: visualize adjacency/reach lines between positions
- [ ] Multi-form characters (Claire's genius_* forms) — form switcher
- [ ] Empty/error states for missing sprites

---

## ❓ Open questions
- Exact adjacency/targeting rules per position (front/back reach) — confirm from game
- Gem vs relic UI treatment (shared equip pool, `type` column already distinguishes)
- Whether consumable items belong in the builder

---

## 🗺️ Data model notes
- Team = **6 characters, positioning matters**; front (left) / back (right); position affects targeting reach & adjacency
- `effective = base × passive skills × town/building boosts × relics/gems`; derived (HP/MP/resist) computed from modified base
- `data_version` per class row tracks extraction currency (target 0.9.2)
