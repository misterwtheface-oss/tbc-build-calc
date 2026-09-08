/* Time Break Chronicles — Team Builder SPA (ES module; loaded after data.js) */
import { computeEffective } from './engine.mjs';

const TBC = window.TBC_DATA || { classes: [], relics: [] };
const $ = s => document.querySelector(s);
const el = (t, cls, html) => { const n = document.createElement(t); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

// ---- config / lookups ----
const N = 6;
const RELIC_SLOTS = 4;                 // confirmed: heroes bind up to 4 relics/gems (user-verified)
const LINE = i => (i % 2 === 0 ? 'front' : 'back');
const POSLABEL = ['F1', 'B1', 'F2', 'B2', 'F3', 'B3'];
const STAT_ORDER = [['pow', 'pow'], ['foc', 'pow'], ['spd', 'util'], ['tgh', 'def'], ['dsc', 'def'],
                    ['agi', 'util'], ['end', 'util'], ['wis', 'res'], ['tec', 'res']];
const byId = id => TBC.classes.find(c => c.id === id);
const relicById = new Map((TBC.relics || []).map(r => [r.id, r]));

// ---- tag → icon mapping (from TBC_DATA.filters) : reusable chip renderer for info panels ----
const filterByTag = new Map((TBC.filters || []).map(f => [f.tag, f]));
const DIM_ORDER = ['damage_type', 'skill_type', 'status', 'attribute', 'enemy_type'];
const sortTags = tags => (tags || []).slice().sort((a, b) =>
  (DIM_ORDER.indexOf(filterByTag.get(a)?.dimension) - DIM_ORDER.indexOf(filterByTag.get(b)?.dimension))
  || a.localeCompare(b));
// A tag chip carries data-tag + data-dim so future filtering / trait-map traversal can hook it.
const tagChip = tag => {
  const f = filterByTag.get(tag); if (!f) return '';
  return `<span class="chip" data-tag="${f.tag}" data-dim="${f.dimension}" title="${escapeAttr(f.label)}">` +
    `<img src="${f.icon}" alt="" loading="lazy" onerror="this.remove()"><span>${f.label}</span></span>`;
};
const tagChips = tags => sortTags(tags).map(tagChip).join('');

// ---- state (schema v2: slots hold class + equipped relics) ----
let _restoreSel = null;      // set by load() to the persisted selected-slot index (declare before use — TDZ)
let team = load();
let selected = (_restoreSel != null && team[_restoreSel]) ? _restoreSel : null;   // slot index shown in readout
let pickerSlot = null;       // slot index being assigned a class
let relicTarget = null;      // { slot, ri } being assigned a relic

function normSlot(s) {
  return s && s.classId && byId(s.classId)            // drop a stale class id no longer in the data
    ? { classId: s.classId, relics: Array.isArray(s.relics) ? s.relics.slice(0, RELIC_SLOTS) : [] }
    : null;
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem('tbc.team') || 'null');
    if (raw && raw.schema === 2 && Array.isArray(raw.slots) && raw.slots.length === N) {
      _restoreSel = Number.isInteger(raw.selected) ? raw.selected : null;
      return raw.slots.map(normSlot);
    }
    if (Array.isArray(raw) && raw.length === N)                      // migrate v1 (array of class ids)
      return raw.map(cid => (cid ? { classId: cid, relics: [] } : null));
  } catch {}
  return Array(N).fill(null);
}
const save = () => localStorage.setItem('tbc.team', JSON.stringify({ schema: 2, slots: team, selected }));

// equipped relic objects for a slot, and its engine-computed effective stats.
const equippedRelics = slot => (slot.relics || []).map(id => relicById.get(id)).filter(Boolean);
const effOf = slot => computeEffective(byId(slot.classId).base, equippedRelics(slot));

// ---- render: formation grid ----
function renderGrid() {
  const grid = $('#grid'); grid.innerHTML = '';
  for (let i = 0; i < N; i++) {
    const s = team[i];
    const slot = el('div', 'slot ' + (s ? 'filled' : 'empty') + (selected === i ? ' selected' : ''));
    slot.dataset.line = LINE(i);
    slot.append(el('span', 'pos', POSLABEL[i]));
    if (!s) {
      slot.append(el('span', 'plus', '+'), el('span', 'add-label', 'Assign'));
      slot.onclick = () => openPicker(i);
    } else {
      const c = byId(s.classId); const d = effOf(s).derived;
      const rm = el('button', 'remove', '✕'); rm.title = 'Remove';
      rm.onclick = e => { e.stopPropagation(); team[i] = null; if (selected === i) selected = null; save(); render(); };
      const img = el('img', 'portrait'); img.src = c.sprite; img.alt = c.name; img.loading = 'lazy';
      img.onerror = () => { img.style.visibility = 'hidden'; };
      const nEq = (s.relics || []).filter(Boolean).length;
      slot.append(rm, img,
        el('span', 'cname', c.name),
        el('span', 'ccls', c.character),
        el('div', 'ministats', `<span>HP <b>${d.hp}</b></span><span>MP <b>${d.mp}</b></span>` +
          (nEq ? `<span class="eqcount">◆${nEq}</span>` : '')));
      slot.onclick = () => { selected = i; render(); };
    }
    grid.append(slot);
  }
}

// ---- render: readout (selected character: relics + effective stats) ----
function renderReadout() {
  const box = $('#readout');
  if (selected == null || !team[selected]) { box.hidden = true; return; }
  box.hidden = false;
  const s = team[selected]; const c = byId(s.classId);
  const eff = effOf(s);

  // relic slots (mirror the game gem grid)
  let slotsHtml = '';
  for (let ri = 0; ri < RELIC_SLOTS; ri++) {
    const rid = (s.relics || [])[ri];
    const r = rid && relicById.get(rid);
    slotsHtml += r
      ? `<button class="relic-slot filled" data-ri="${ri}" title="${escapeAttr(r.name)} — tap to remove">
           <img src="${r.sprite}" alt="${escapeAttr(r.name)}" onerror="this.style.visibility='hidden'">
         </button>`
      : `<button class="relic-slot empty" data-ri="${ri}" title="Equip relic/gem"><span>+</span></button>`;
  }

  // effective stat cells (show base → effective delta when modified)
  const cell = ([k, cls]) => {
    const base = c.base[k], e = Math.round(eff.effective[k]);
    const changed = e !== base;
    const delta = changed ? `<div class="delta ${e > base ? 'up' : 'down'}">${e > base ? '+' : ''}${e - base}</div>` : '';
    return `<div class="stat ${cls}${changed ? ' mod' : ''}">
      <div class="k">${k.toUpperCase()}</div><div class="v">${e}</div>
      ${changed ? `<div class="basev">${base}</div>` : ''}${delta}</div>`;
  };
  const D = (k, v, cls = 'derived') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;

  // equipped list with effect text (situational relics flagged)
  const eqList = equippedRelics(s).map(r =>
    `<li class="${r.effectModeled ? '' : 'situational'}">
       <span class="eq-name">${r.name}</span>
       <span class="eq-eff">${r.effect || ''}${r.effectModeled ? '' : ' <em>· situational (not applied to stats)</em>'}</span>
       ${r.tags && r.tags.length ? `<div class="chips">${tagChips(r.tags)}</div>` : ''}
     </li>`).join('') || '<li class="muted">No relics/gems equipped.</li>';

  box.innerHTML = `
    <div class="rt-head">
      <img src="${c.sprite}" alt="" onerror="this.style.visibility='hidden'">
      <div><h2>${c.name}</h2><div class="sub">${c.character} · ${POSLABEL[selected]} (${LINE(selected)} line)</div></div>
    </div>
    ${c.tags && c.tags.length ? `<div class="rt-section">KIT TAGS</div><div class="chips">${tagChips(c.tags)}</div>` : ''}
    <div class="rt-section">RELICS / GEMS</div>
    <div class="relic-slots">${slotsHtml}</div>
    <div class="rt-section">DERIVED (effective)</div>
    <div class="statgrid">
      ${D('HP', eff.derived.hp)}${D('MP', eff.derived.mp)}${D('ELE%', eff.derived.elePct + '%')}
      ${D('TGH%', eff.derived.tghPct + '%', 'res')}${D('DSC%', eff.derived.dscPct + '%', 'res')}${D('', '')}
    </div>
    <div class="rt-section">ATTRIBUTES (base → effective)</div>
    <div class="statgrid">${STAT_ORDER.map(cell).join('')}</div>
    <div class="rt-section">EQUIPPED</div>
    <ul class="eq-list">${eqList}</ul>`;

  box.querySelectorAll('.relic-slot').forEach(b => {
    const ri = Number(b.dataset.ri);
    b.onclick = () => {
      if (b.classList.contains('filled')) { team[selected].relics[ri] = null; save(); render(); }
      else openRelicPicker(selected, ri);
    };
  });
}

// ---- class picker overlay ----
function openPicker(i) {
  pickerSlot = i;
  $('#pickerSlotLabel').textContent = '→ ' + POSLABEL[i] + ' (' + LINE(i) + ')';
  $('#pickerSearch').value = ''; filterPicker('');
  $('#pickerOverlay').hidden = false; $('#pickerSearch').focus();
}
const closePicker = () => { $('#pickerOverlay').hidden = true; pickerSlot = null; };
function buildPicker() {
  const g = $('#pickerGrid'); g.innerHTML = '';
  TBC.classes.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
    const card = el('div', 'pcard');
    card.dataset.q = (c.name + ' ' + c.character + ' ' + c.id).toLowerCase();
    const img = el('img'); img.src = c.sprite; img.loading = 'lazy'; img.alt = '';
    img.onerror = () => { img.style.visibility = 'hidden'; };
    card.append(img, el('div', 'pn', c.name), el('div', 'pc', c.character));
    card.onclick = () => {
      const keep = team[pickerSlot] && team[pickerSlot].classId === c.id ? team[pickerSlot].relics : [];
      team[pickerSlot] = { classId: c.id, relics: keep };
      selected = pickerSlot; save(); closePicker(); render();
    };
    g.append(card);
  });
}
const filterPicker = q => {
  q = q.trim().toLowerCase();
  $('#pickerGrid').querySelectorAll('.pcard').forEach(c => c.classList.toggle('hide', q && !c.dataset.q.includes(q)));
};

// ---- relic/gem picker overlay ----
function openRelicPicker(slot, ri) {
  relicTarget = { slot, ri };
  const c = byId(team[slot].classId);
  $('#relicSlotLabel').textContent = '→ ' + c.name + ' · slot ' + (ri + 1);
  $('#relicSearch').value = ''; filterRelicPicker('');
  markEquipped();
  $('#relicOverlay').hidden = false; $('#relicSearch').focus();
}
const closeRelicPicker = () => { $('#relicOverlay').hidden = true; relicTarget = null; };
function buildRelicPicker() {
  const g = $('#relicGrid'); if (!g) return; g.innerHTML = '';
  (TBC.relics || []).slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)).forEach(r => {
    const card = el('div', 'pcard rcard' + (r.effectModeled ? '' : ' situational'));
    card.dataset.id = r.id;
    card.dataset.q = ((r.name || '') + ' ' + (r.effect || '') + ' ' + r.type + ' ' + r.id).toLowerCase();
    const img = el('img'); img.src = r.sprite; img.loading = 'lazy'; img.alt = '';
    img.onerror = () => { img.style.visibility = 'hidden'; };
    card.append(img,
      el('div', 'pn', r.name || r.id),
      el('div', 'rtype', r.type === 'gem' ? 'GEM' : 'RELIC'),
      el('div', 'reff', r.effectShort && r.effectShort !== '-' ? r.effectShort : (r.effect || '')));
    card.onclick = () => {
      if (card.classList.contains('equipped')) return;
      team[relicTarget.slot].relics[relicTarget.ri] = r.id;
      save(); closeRelicPicker(); render();
    };
    g.append(card);
  });
}
const filterRelicPicker = q => {
  q = q.trim().toLowerCase();
  $('#relicGrid').querySelectorAll('.rcard').forEach(c => c.classList.toggle('hide', q && !c.dataset.q.includes(q)));
};
function markEquipped() {                              // dim relics already on this character
  const on = new Set((team[relicTarget.slot].relics || []).filter(Boolean));
  $('#relicGrid').querySelectorAll('.rcard').forEach(c => c.classList.toggle('equipped', on.has(c.dataset.id)));
}

const escapeAttr = s => String(s || '').replace(/"/g, '&quot;');
function render() { renderGrid(); renderReadout(); }

// ---- wire up ----
$('#dataVer').textContent = 'v' + (TBC.version || '');
$('#clearTeam').onclick = () => { team = Array(N).fill(null); selected = null; save(); render(); };
$('#pickerSearch').addEventListener('input', e => filterPicker(e.target.value));
$('#relicSearch')?.addEventListener('input', e => filterRelicPicker(e.target.value));
document.querySelectorAll('[data-close]').forEach(x => x.onclick = () => { closePicker(); closeRelicPicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePicker(); closeRelicPicker(); } });

buildPicker();
buildRelicPicker();
render();
