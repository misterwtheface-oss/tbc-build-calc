/* Time Break Chronicles — Team Builder SPA (ES module; loaded after data.js)
   House style (see .claude/skills/build-calc-planner/references/ui-conventions.md):
   build-first view, two-root overlays (#overlay-root / #detail-overlay-root),
   statically-sized panels, pending→Confirm selection, event delegation,
   scroll-preserving refreshOverlay. Stat table per trait-and-stat-conventions.md. */
import { computeEffective } from './engine.mjs';

const TBC = window.TBC_DATA || { classes: [], relics: [], filters: [] };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- config / lookups ----
const N = 6, RELIC_SLOTS = 4;                 // confirmed: heroes bind up to 4 relics/gems
const LINE = i => (i % 2 === 0 ? 'front' : 'back');
const POSLABEL = ['F1', 'B1', 'F2', 'B2', 'F3', 'B3'];
const STAT_KEYS = ['pow', 'foc', 'spd', 'tgh', 'dsc', 'agi', 'end', 'wis', 'tec'];
const STAT_LABEL = { pow: 'Power', foc: 'Focus', spd: 'Speed', tgh: 'Toughness', dsc: 'Discipline',
  agi: 'Agility', end: 'Endurance', wis: 'Wisdom', tec: 'Technique' };
const classById = new Map(TBC.classes.map(c => [c.id, c]));
const relicById = new Map((TBC.relics || []).map(r => [r.id, r]));
const classesSorted = TBC.classes.slice().sort((a, b) => a.name.localeCompare(b.name));
const relicsSorted = (TBC.relics || []).slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

// ---- tag → icon chips (association surfacing) ----
const filterByTag = new Map((TBC.filters || []).map(f => [f.tag, f]));
const DIM_ORDER = ['damage_type', 'skill_type', 'status', 'attribute', 'enemy_type'];
const sortTags = tags => (tags || []).slice().sort((a, b) =>
  (DIM_ORDER.indexOf(filterByTag.get(a)?.dimension) - DIM_ORDER.indexOf(filterByTag.get(b)?.dimension)) || a.localeCompare(b));
const tagChip = tag => {
  const f = filterByTag.get(tag); if (!f) return '';
  return `<span class="chip" data-dim="${f.dimension}" title="${esc(f.label)}">` +
    `<img src="${esc(f.icon)}" alt="" loading="lazy" onerror="this.remove()"><span>${esc(f.label)}</span></span>`;
};
const tagChips = tags => sortTags(tags).map(tagChip).join('');

// ---- state ----
let _restoreSel = null;
let team = load();
let selected = (_restoreSel != null && team[_restoreSel]) ? _restoreSel : null;
let ovl = null;   // selector overlay: { kind:'class'|'relic', slot, ri, pending, search }

function normSlot(s) {
  return s && s.classId && classById.get(s.classId)
    ? { classId: s.classId, relics: Array.isArray(s.relics) ? s.relics.slice(0, RELIC_SLOTS) : [] } : null;
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem('tbc.team') || 'null');
    if (raw && raw.schema === 2 && Array.isArray(raw.slots) && raw.slots.length === N) {
      _restoreSel = Number.isInteger(raw.selected) ? raw.selected : null;
      return raw.slots.map(normSlot);
    }
    if (Array.isArray(raw) && raw.length === N) return raw.map(cid => (cid ? { classId: cid, relics: [] } : null));
  } catch {}
  return Array(N).fill(null);
}
const save = () => localStorage.setItem('tbc.team', JSON.stringify({ schema: 2, slots: team, selected }));

const equippedRelics = slot => (slot.relics || []).map(id => relicById.get(id)).filter(Boolean);
const effOf = slot => computeEffective(classById.get(slot.classId).base, equippedRelics(slot));

// ═══════════════════════════ BUILD VIEW ═══════════════════════════
function renderGrid() {
  const grid = $('#grid');
  let html = '';
  for (let i = 0; i < N; i++) {
    const s = team[i];
    if (!s) {
      html += `<div class="slot empty" data-line="${LINE(i)}" data-action="open-class" data-slot="${i}">
        <span class="pos">${POSLABEL[i]}</span><span class="plus">+</span><span class="add-label">Assign</span></div>`;
    } else {
      const c = classById.get(s.classId), d = effOf(s).derived;
      const nEq = (s.relics || []).filter(Boolean).length;
      html += `<div class="slot filled${selected === i ? ' selected' : ''}" data-line="${LINE(i)}" data-action="select" data-slot="${i}">
        <span class="pos">${POSLABEL[i]}</span>
        <button class="remove" title="Remove" data-action="remove-slot" data-slot="${i}">✕</button>
        <div class="portrait"><img src="${esc(c.sprite)}" alt="${esc(c.name)}" loading="lazy" onerror="this.style.visibility='hidden'"></div>
        <span class="cname">${esc(c.name)}</span><span class="ccls">${esc(c.character)}</span>
        <div class="ministats"><span>HP <b>${d.hp}</b></span><span>MP <b>${d.mp}</b></span>${nEq ? `<span class="eqcount">◆${nEq}</span>` : ''}</div>
      </div>`;
    }
  }
  grid.innerHTML = html;
}

// The grid stat table (Stat | Base | Relics | Total) per trait-and-stat-conventions.md.
function statTable(classBase, effBase, effective) {
  const rows = STAT_KEYS.map(k => {
    const cb = classBase[k], b = Math.round(effBase[k]), tot = Math.round(effective[k]);
    const baseChanged = b !== cb;                                   // flat/scale folded into base
    const mult = effBase[k] ? effective[k] / effBase[k] : 1;
    const hasMult = Math.abs(mult - 1) > 0.005;
    const capped = effective[k] >= 2 * effBase[k] - 1e-6 || (hasMult && mult < 1 && effective[k] <= 0.15 * effBase[k] + 1e-6);
    const tier = (baseChanged && hasMult) ? 'hl-high' : (baseChanged || hasMult) ? 'hl-med' : '';
    const src = hasMult ? `<span class="stat-val ${mult > 1 ? 'pos' : 'neg'}">×${mult.toFixed(2)}</span>` : '<span class="dim">·</span>';
    return `<div class="stat-row ${tier}${capped ? ' capped' : ''}">
      <span class="stat-key">${STAT_LABEL[k]}</span>
      <span class="stat-base">${baseChanged ? `<span class="stat-val pos">${b}</span>` : b}</span>
      <span class="stat-src">${src}</span>
      <span class="stat-total">${tot}</span></div>`;
  }).join('');
  return `<div class="stat-grid">
    <div class="stat-header"><span>Stat</span><span>Base</span><span>Relics</span><span>Total</span></div>
    ${rows}</div>`;
}

function renderReadout() {
  const box = $('#readout');
  if (selected == null || !team[selected]) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const s = team[selected], c = classById.get(s.classId), eff = effOf(s);

  let slotsHtml = '';
  for (let ri = 0; ri < RELIC_SLOTS; ri++) {
    const r = (s.relics || [])[ri] && relicById.get(s.relics[ri]);
    slotsHtml += r
      ? `<button class="relic-slot filled" data-action="remove-relic" data-slot="${selected}" data-ri="${ri}" title="${esc(r.name)} — remove">
           <img src="${esc(r.sprite)}" alt="${esc(r.name)}" onerror="this.style.visibility='hidden'"></button>`
      : `<button class="relic-slot empty" data-action="open-relic" data-slot="${selected}" data-ri="${ri}" title="Equip relic/gem"><span>+</span></button>`;
  }

  const d = eff.derived;
  const derivedStrip = [['HP', d.hp], ['MP', d.mp], ['ELE', d.elePct + '%'], ['TGH', d.tghPct + '%'], ['DSC', d.dscPct + '%']]
    .map(([k, v]) => `<div class="dpill"><span class="dk">${k}</span><span class="dv">${v}</span></div>`).join('');

  const eqList = equippedRelics(s).map(r =>
    `<li class="${r.effectModeled ? '' : 'situational'}">
       <span class="eq-name">${esc(r.name)}</span>
       <span class="eq-eff">${esc(r.effect || '')}${r.effectModeled ? '' : ' <em>· situational</em>'}</span>
       ${r.tags && r.tags.length ? `<div class="chips">${tagChips(r.tags)}</div>` : ''}</li>`).join('')
    || '<li class="muted">No relics/gems equipped.</li>';

  box.innerHTML = `
    <div class="rt-head">
      <div class="portrait lg"><img src="${esc(c.sprite)}" alt="" onerror="this.style.visibility='hidden'"></div>
      <div class="rt-id"><h2>${esc(c.name)}</h2><div class="sub">${esc(c.character)} · ${POSLABEL[selected]} (${LINE(selected)} line)</div></div>
    </div>
    ${c.tags && c.tags.length ? `<div class="rt-section">KIT TAGS</div><div class="chips">${tagChips(c.tags)}</div>` : ''}
    <div class="rt-section">RELICS / GEMS</div>
    <div class="relic-slots">${slotsHtml}</div>
    <div class="rt-section">DERIVED</div>
    <div class="derived-strip">${derivedStrip}</div>
    <div class="rt-section">ATTRIBUTES</div>
    ${statTable(c.base, eff.effBase, eff.effective)}
    <div class="rt-section">EQUIPPED</div>
    <ul class="eq-list">${eqList}</ul>`;
}

function render() { renderGrid(); renderReadout(); }

// ═══════════════════════ SELECTOR OVERLAY (#overlay-root) ═══════════════════════
const SCROLLERS = ['.ovl-center-scroll', '.ovl-info', '.ovl-left', '.ovl-right-body'];

function overlayTitle() {
  if (ovl.kind === 'class') return `Select Class — ${POSLABEL[ovl.slot]} (${LINE(ovl.slot)})`;
  const c = classById.get(team[ovl.slot].classId);
  return `Equip Relic / Gem — ${esc(c.name)} · slot ${ovl.ri + 1}`;
}
function openOverlay(kind, slot, ri) {
  ovl = { kind, slot, ri, search: '',
    pending: kind === 'class' ? (team[slot] ? team[slot].classId : null) : ((team[slot].relics || [])[ri] || null) };
  const root = $('#overlay-root');
  root.innerHTML = `
    <div class="overlay-panel" role="dialog" aria-modal="true">
      <div class="overlay-header"><h2>${overlayTitle()}</h2>
        <button class="overlay-close" data-action="cancel" aria-label="Close">&times;</button></div>
      <div class="overlay-body">
        <div class="ovl-center">
          <div class="ovl-center-search"><input class="ovl-search" type="search" placeholder="Search…" autocomplete="off"></div>
          <div class="ovl-center-scroll"><div class="ovl-grid"></div></div>
        </div>
        <div class="ovl-info">
          <div class="ovl-left"></div>
          <div class="ovl-right"></div>
        </div>
      </div>
      <div class="overlay-footer">
        <button class="btn ghost" data-action="cancel">Cancel</button>
        <button class="btn primary" data-action="confirm">Confirm</button>
      </div>
    </div>`;
  root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
  refreshOverlay();
  root.querySelector('.ovl-search')?.focus();
}

function refreshOverlay() {
  const panel = $('#overlay-root .overlay-panel');
  if (!panel || !ovl) return;
  const saved = SCROLLERS.map(sel => panel.querySelector(sel)?.scrollTop || 0);
  const q = ovl.search.trim().toLowerCase();

  // center grid
  let gridHtml = '';
  if (ovl.kind === 'class') {
    const list = classesSorted.filter(c => !q || (c.name + ' ' + c.character + ' ' + c.id).toLowerCase().includes(q));
    gridHtml = list.map(c => `<div class="ovl-card${c.id === ovl.pending ? ' selected' : ''}" data-action="pick" data-id="${esc(c.id)}" title="${esc(c.name)}">
      <img src="${esc(c.sprite)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span class="oc-name">${esc(c.name)}</span></div>`).join('')
      || '<p class="muted">No matches.</p>';
  } else {
    const equipped = new Set((team[ovl.slot].relics || []).filter(Boolean));
    const list = relicsSorted.filter(r => !q || ((r.name || '') + ' ' + (r.effect || '') + ' ' + r.type + ' ' + r.id).toLowerCase().includes(q));
    gridHtml = list.map(r => {
      const on = equipped.has(r.id) && r.id !== ovl.pending;
      return `<div class="ovl-card rcard${r.id === ovl.pending ? ' selected' : ''}${on ? ' equipped' : ''}${r.effectModeled ? '' : ' situational'}"
        ${on ? '' : `data-action="pick" data-id="${esc(r.id)}"`} title="${esc(r.name || r.id)}">
        <img src="${esc(r.sprite)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span class="oc-name">${esc(r.name || r.id)}</span></div>`;
    }).join('') || '<p class="muted">No matches.</p>';
  }
  panel.querySelector('.ovl-grid').innerHTML = gridHtml;

  // left (stats/effect preview) + right (identity/detail)
  fillInfo(panel);
  panel.querySelector('.overlay-body').classList.toggle('has-selection', !!ovl.pending);

  SCROLLERS.forEach((sel, i) => { const el = panel.querySelector(sel); if (el) el.scrollTop = saved[i]; });
}

function fillInfo(panel) {
  const left = panel.querySelector('.ovl-left'), right = panel.querySelector('.ovl-right');
  if (!ovl.pending) {
    left.innerHTML = `<h3>Stats</h3><p class="muted">Select to preview.</p>`;
    right.innerHTML = `<div class="ovl-right-top"><h3>Details</h3></div><div class="ovl-right-body"><p class="muted">Select ${ovl.kind === 'class' ? 'a class' : 'a relic'} to see details.</p></div>`;
    return;
  }
  if (ovl.kind === 'class') {
    const c = classById.get(ovl.pending);
    const preview = computeEffective(c.base, []);
    left.innerHTML = `<h3>Base attributes</h3>${statTable(c.base, preview.effBase, preview.effective)}`;
    right.innerHTML = `<div class="ovl-right-top">
        <div class="portrait lg"><img src="${esc(c.sprite)}" alt="" onerror="this.style.visibility='hidden'"></div>
        <h3>${esc(c.name)}</h3><div class="sub">${esc(c.character)}${c.act ? ' · ' + esc(c.act) : ''}</div>
        <button class="btn ghost sm" data-action="detail" data-id="${esc(c.id)}">More info</button></div>
      <div class="ovl-right-body">${c.tags && c.tags.length ? `<div class="chips">${tagChips(c.tags)}</div>` : '<p class="muted">No kit tags.</p>'}</div>`;
  } else {
    const r = relicById.get(ovl.pending);
    const mods = (r.statMods || []).map(m => `<div class="stat-row"><span class="stat-key">${STAT_LABEL[m.stat] || m.stat}</span>
        <span class="stat-src">${m.flat ? `<span class="stat-val ${m.flat > 0 ? 'pos' : 'neg'}">${m.flat > 0 ? '+' : ''}${m.flat}</span>` : ''}</span>
        <span class="stat-total">${m.pct ? `<span class="stat-val ${m.pct > 0 ? 'pos' : 'neg'}">${m.pct > 0 ? '+' : ''}${m.pct}%</span>` : ''}</span></div>`).join('');
    left.innerHTML = `<h3>Stat effect</h3>` + (mods || `<p class="muted">${r.effectModeled ? '' : 'Situational — '}no flat/% stat mods.</p>`);
    right.innerHTML = `<div class="ovl-right-top">
        <div class="relic-slot filled static"><img src="${esc(r.sprite)}" alt="" onerror="this.style.visibility='hidden'"></div>
        <h3>${esc(r.name || r.id)}</h3><div class="sub">${r.type === 'gem' ? 'Gem' : 'Relic'}${r.grantedSkill && r.grantedSkill !== '-' ? ' · grants ' + esc(r.grantedSkill) : ''}</div>
        <button class="btn ghost sm" data-action="detail" data-id="${esc(r.id)}">More info</button></div>
      <div class="ovl-right-body"><p class="reff">${esc(r.effect || '')}</p>${r.tags && r.tags.length ? `<div class="chips">${tagChips(r.tags)}</div>` : ''}</div>`;
  }
}

function closeOverlay(commit) {
  if (!ovl) return;
  if (commit && ovl.pending) {
    if (ovl.kind === 'class') {
      const keep = team[ovl.slot] && team[ovl.slot].classId === ovl.pending ? team[ovl.slot].relics : [];
      team[ovl.slot] = { classId: ovl.pending, relics: keep };
      selected = ovl.slot;
    } else {
      team[ovl.slot].relics[ovl.ri] = ovl.pending;
    }
    save();
  }
  ovl = null;
  const root = $('#overlay-root');
  root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); root.innerHTML = '';
  render();
}

// ═══════════════════ DETAIL OVERLAY (#detail-overlay-root, stacks above) ═══════════════════
function openDetail(kind, id) {
  const root = $('#detail-overlay-root');
  let title = '', bodyHtml = '';
  if (kind === 'class') {
    const c = classById.get(id); if (!c) return;
    const pv = computeEffective(c.base, []);
    title = c.name;
    bodyHtml = `<div class="detail-id"><div class="portrait xl"><img src="${esc(c.sprite)}" alt="" onerror="this.style.visibility='hidden'"></div>
        <div><h3>${esc(c.name)}</h3><div class="sub">${esc(c.character)}${c.act ? ' · ' + esc(c.act) : ''}</div>
        ${c.tags && c.tags.length ? `<div class="chips">${tagChips(c.tags)}</div>` : ''}</div></div>
      <div class="rt-section">ATTRIBUTES</div>${statTable(c.base, pv.effBase, pv.effective)}
      ${(c.skills && c.skills.length) ? `<div class="rt-section">SKILLS (${c.skills.length})</div><div class="detail-skills">${c.skills.map(esc).join(' · ')}</div>` : ''}`;
  } else {
    const r = relicById.get(id); if (!r) return;
    title = r.name || r.id;
    bodyHtml = `<div class="detail-id"><div class="relic-slot filled static lg"><img src="${esc(r.sprite)}" alt="" onerror="this.style.visibility='hidden'"></div>
        <div><h3>${esc(r.name || r.id)}</h3><div class="sub">${r.type === 'gem' ? 'Gem' : 'Relic'}${r.unlockClass && r.unlockClass !== '-' ? ' · unlocks: ' + esc(r.unlockClass) : ''}</div>
        ${r.tags && r.tags.length ? `<div class="chips">${tagChips(r.tags)}</div>` : ''}</div></div>
      <p class="reff">${esc(r.effect || '')}</p>
      ${r.grantedSkill && r.grantedSkill !== '-' ? `<div class="rt-section">GRANTS SKILL</div><div class="detail-skills">${esc(r.grantedSkill)}</div>` : ''}`;
  }
  root.innerHTML = `<div class="overlay-panel" role="dialog" aria-modal="true">
      <div class="overlay-header"><h2>${esc(title)}</h2><button class="overlay-close" data-action="close-detail" aria-label="Close">&times;</button></div>
      <div class="overlay-body"><div class="ovl-center"><div class="ovl-center-scroll detail-main">${bodyHtml}</div></div></div>
      <div class="overlay-footer"><button class="btn primary" data-action="close-detail">Close</button></div></div>`;
  root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
}
function closeDetail() {
  const root = $('#detail-overlay-root');
  root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); root.innerHTML = '';
}

// ═══════════════════════════ EVENT DELEGATION ═══════════════════════════
function act(e) { return e.target.closest('[data-action]'); }
$('.stage').addEventListener('click', e => {
  const el = act(e); if (!el) return;
  const slot = Number(el.dataset.slot), ri = Number(el.dataset.ri);
  switch (el.dataset.action) {
    case 'open-class': openOverlay('class', slot); break;
    case 'select': selected = slot; save(); render(); break;
    case 'remove-slot': team[slot] = null; if (selected === slot) selected = null; save(); render(); break;
    case 'open-relic': selected = slot; openOverlay('relic', slot, ri); break;
    case 'remove-relic': team[slot].relics[ri] = null; save(); render(); break;
  }
});
$('#overlay-root').addEventListener('click', e => {
  const el = act(e);
  if (!el) { if (e.target.id === 'overlay-root') closeOverlay(false); return; }   // backdrop = dismiss
  switch (el.dataset.action) {
    case 'pick': ovl.pending = ovl.pending === el.dataset.id ? null : el.dataset.id; refreshOverlay(); break;
    case 'detail': openDetail(ovl.kind, el.dataset.id); break;
    case 'cancel': closeOverlay(false); break;
    case 'confirm': closeOverlay(true); break;
  }
});
$('#overlay-root').addEventListener('input', e => {
  if (!e.target.classList.contains('ovl-search') || !ovl) return;
  ovl.search = e.target.value; refreshOverlay();
});
$('#detail-overlay-root').addEventListener('click', e => {
  const el = act(e);
  if ((el && el.dataset.action === 'close-detail') || e.target.id === 'detail-overlay-root') closeDetail();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#detail-overlay-root').classList.contains('hidden')) return closeDetail();
  if (ovl) closeOverlay(false);
});
$('#clearTeam').onclick = () => { team = Array(N).fill(null); selected = null; save(); render(); };

// ---- init ----
$('#dataVer').textContent = 'v' + (TBC.version || '');
render();
