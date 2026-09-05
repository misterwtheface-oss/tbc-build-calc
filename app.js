/* Time Break Chronicles — Team Builder SPA */
(() => {
  const TBC = window.TBC || { classes: [] };
  const $ = s => document.querySelector(s);
  const el = (t, cls, html) => { const n = document.createElement(t); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

  // ---- stat model (reverse-engineered formulas) ----
  const resist = s => Math.round(155.4 * s / (s + 206.6) - 3.4);
  function derive(base, ov = {}) {
    const tghPct = resist(base.tgh), dscPct = resist(base.dsc);
    return {
      hp: ov.hp ?? Math.round(6.543 * base.end + 165),
      mp: ov.mp ?? Math.round(4 * base.wis + 5),
      tghPct, dscPct, elePct: Math.round((tghPct + dscPct) / 2),
    };
  }

  // ---- state ----
  const N = 6;
  const LINE = i => (i % 2 === 0 ? 'front' : 'back');   // even = front (left), odd = back (right)
  const POSLABEL = ['F1', 'B1', 'F2', 'B2', 'F3', 'B3'];
  let team = load();
  let selected = null;         // index of slot shown in readout
  let pickerSlot = null;       // index being assigned

  function load() {
    try { const t = JSON.parse(localStorage.getItem('tbc.team') || '[]'); if (Array.isArray(t) && t.length === N) return t; } catch {}
    return Array(N).fill(null);
  }
  const save = () => localStorage.setItem('tbc.team', JSON.stringify(team));
  const byId = id => TBC.classes.find(c => c.id === id);

  // ---- render: formation grid ----
  function renderGrid() {
    const grid = $('#grid'); grid.innerHTML = '';
    for (let i = 0; i < N; i++) {
      const cid = team[i];
      const slot = el('div', 'slot ' + (cid ? 'filled' : 'empty') + (selected === i ? ' selected' : ''));
      slot.dataset.line = LINE(i);
      slot.append(el('span', 'pos', POSLABEL[i]));
      if (!cid) {
        slot.append(el('span', 'plus', '+'), el('span', 'add-label', 'Assign'));
        slot.onclick = () => openPicker(i);
      } else {
        const c = byId(cid); const d = derive(c.base, { hp: c.hpOverride, mp: c.mpOverride });
        const rm = el('button', 'remove', '✕'); rm.title = 'Remove';
        rm.onclick = e => { e.stopPropagation(); team[i] = null; if (selected === i) selected = null; save(); render(); };
        const img = el('img', 'portrait'); img.src = c.sprite; img.alt = c.name; img.loading = 'lazy';
        img.onerror = () => { img.style.visibility = 'hidden'; };
        slot.append(rm, img,
          el('span', 'cname', c.name),
          el('span', 'ccls', c.character),
          el('div', 'ministats', `<span>HP <b>${d.hp}</b></span><span>MP <b>${d.mp}</b></span>`));
        slot.onclick = () => { selected = i; render(); };
      }
      grid.append(slot);
    }
  }

  // ---- render: readout ----
  function renderReadout() {
    const box = $('#readout');
    if (selected == null || !team[selected]) { box.hidden = true; return; }
    box.hidden = false;
    const c = byId(team[selected]); const b = c.base; const d = derive(b, { hp: c.hpOverride, mp: c.mpOverride });
    const S = (k, v, cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    box.innerHTML = `
      <div class="rt-head">
        <img src="${c.sprite}" alt="" onerror="this.style.visibility='hidden'">
        <div><h2>${c.name}</h2><div class="sub">${c.character} · ${POSLABEL[selected]} (${LINE(selected)} line)</div></div>
      </div>
      <div class="rt-section">DERIVED</div>
      <div class="statgrid">
        ${S('HP', d.hp, 'derived')}${S('MP', d.mp, 'derived')}${S('ELE%', d.elePct + '%', 'derived')}
        ${S('TGH%', d.tghPct + '%', 'res')}${S('DSC%', d.dscPct + '%', 'res')}${S('', '', '')}
      </div>
      <div class="rt-section">BASE ATTRIBUTES</div>
      <div class="statgrid">
        ${S('POW', b.pow, 'pow')}${S('FOC', b.foc, 'pow')}${S('SPD', b.spd, 'util')}
        ${S('TGH', b.tgh, 'def')}${S('DSC', b.dsc, 'def')}${S('AGI', b.agi, 'util')}
        ${S('END', b.end, 'util')}${S('WIS', b.wis, 'res')}${S('TEC', b.tec, 'res')}
      </div>`;
  }

  // ---- picker overlay ----
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
      card.onclick = () => { team[pickerSlot] = c.id; selected = pickerSlot; save(); closePicker(); render(); };
      g.append(card);
    });
  }
  const filterPicker = q => {
    q = q.trim().toLowerCase();
    $('#pickerGrid').querySelectorAll('.pcard').forEach(c => c.classList.toggle('hide', q && !c.dataset.q.includes(q)));
  };

  function render() { renderGrid(); renderReadout(); }

  // ---- wire up ----
  $('#dataVer').textContent = 'v' + (TBC.version || '');
  $('#clearTeam').onclick = () => { team = Array(N).fill(null); selected = null; save(); render(); };
  $('#pickerSearch').addEventListener('input', e => filterPicker(e.target.value));
  document.querySelectorAll('[data-close]').forEach(x => x.onclick = closePicker);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });

  buildPicker();
  render();
})();
