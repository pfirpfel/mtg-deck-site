(() => {
  const html = document.documentElement;
  const mobile = matchMedia('(max-width: 900px)');
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };

  // --- Sidebar --------------------------------------------------------------
  document.querySelector('.menu-toggle')?.addEventListener('click', () => {
    if (mobile.matches) {
      html.classList.toggle('sidebar-open');
    } else {
      const hidden = html.classList.toggle('sidebar-hidden');
      store.set('sidebar', hidden ? 'hidden' : 'shown');
    }
  });
  document.querySelector('[data-close-sidebar]')?.addEventListener('click', () => html.classList.remove('sidebar-open'));
  // Center the current entry in the tree without scrolling the page itself.
  const sidebar = document.getElementById('sidebar');
  const current = sidebar?.querySelector('[aria-current="page"]');
  if (current) {
    const offset = current.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
    sidebar.scrollTop += offset - sidebar.clientHeight / 2;
  }

  // --- Folder view: deck order -----------------------------------------------
  const deckSort = document.getElementById('deck-sort');
  if (deckSort) {
    const list = document.getElementById('decks');
    const items = [...list.children]; // rendered in name order
    const sortDecks = () => {
      const byChanged = deckSort.value === 'changed';
      const sorted = byChanged
        ? [...items].sort((a, b) => (Date.parse(b.dataset.changed) || 0) - (Date.parse(a.dataset.changed) || 0))
        : items;
      list.classList.toggle('by-changed', byChanged);
      list.replaceChildren(...sorted);
    };
    deckSort.value = store.get('deckSort') === 'name' ? 'name' : 'changed';
    deckSort.addEventListener('change', () => { store.set('deckSort', deckSort.value); sortDecks(); });
    sortDecks();
  }

  // --- Deck view ------------------------------------------------------------
  const dataEl = document.getElementById('deck-data');
  if (!dataEl) return;
  const { cards } = JSON.parse(dataEl.textContent);

  const TYPE_ORDER = ['Commander', 'Companion', 'Creature', 'Planeswalker', 'Battle', 'Artifact', 'Enchantment',
    'Instant', 'Sorcery', 'Land', 'Other', 'Unknown', 'Sideboard'];
  const PLURAL = { Creature: 'Creatures', Planeswalker: 'Planeswalkers', Battle: 'Battles', Artifact: 'Artifacts',
    Enchantment: 'Enchantments', Instant: 'Instants', Sorcery: 'Sorceries', Land: 'Lands' };
  const COLOR_ORDER = ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor', 'Colorless', 'Land'];
  const SPECIAL = { commander: 'Commander', companion: 'Companion', sideboard: 'Sideboard' };

  const special = (c) => SPECIAL[c.s];
  // Mana font classes for the group headings.
  const typeIcon = (k) => (k === 'Commander' ? 'ms-commander' : PLURAL[k] ? 'ms-' + k.toLowerCase() : null);
  const COLOR_ICONS = { White: 'ms-w', Blue: 'ms-u', Black: 'ms-b', Red: 'ms-r', Green: 'ms-g', Colorless: 'ms-c' };
  const colorIcon = (k) =>
    COLOR_ICONS[k] ? COLOR_ICONS[k] + ' ms-cost ms-shadow'
      : k === 'Multicolor' ? 'ms-multicolor ms-duo ms-duo-color ms-grad'
        : typeIcon(k);
  const groupings = {
    type: {
      key: (c) => special(c) ?? c.t,
      order: (k) => TYPE_ORDER.indexOf(k),
      label: (k) => PLURAL[k] ?? k,
      icon: typeIcon,
    },
    mv: {
      key: (c) => special(c) ?? (c.t === 'Land' || c.t === 'Unknown' ? c.t : 'MV ' + c.mv),
      order: (k) => ({ Commander: -2, Companion: -1, Land: 1000, Unknown: 1001, Sideboard: 1002 })[k] ?? parseFloat(k.slice(3)),
      label: (k) => (k === 'Land' ? 'Lands' : k.startsWith('MV ') ? 'Mana value ' + k.slice(3) : k),
    },
    color: {
      key: (c) => special(c) ?? (c.t === 'Unknown' ? c.t : c.c),
      order: (k) => ({ Commander: -2, Companion: -1, Unknown: 999, Sideboard: 1000 })[k] ?? COLOR_ORDER.indexOf(k),
      label: (k) => (k === 'Land' ? 'Lands' : k),
      icon: colorIcon,
    },
    none: {
      key: (c) => special(c) ?? 'Deck',
      order: (k) => ({ Commander: -2, Companion: -1, Deck: 0, Sideboard: 1 })[k],
      label: (k) => (k === 'Deck' ? 'Cards' : k),
    },
  };
  const byName = (a, b) => a.n.localeCompare(b.n);
  const sorters = { name: byName, mv: (a, b) => a.mv - b.mv || byName(a, b) };

  const groupSel = document.getElementById('group');
  const sortSel = document.getElementById('sort');
  const groupsEl = document.getElementById('groups');
  const img = document.getElementById('focus-img');
  const link = document.getElementById('focus-link');
  const flip = document.getElementById('flip');

  // On phones the toolbar sits below the card image, so the deck list starts with its first card.
  const toolbar = document.getElementById('toolbar');
  const phone = matchMedia('(max-width: 600px)');
  const placeToolbar = () => {
    if (phone.matches) document.querySelector('.focus-inner').append(toolbar);
    else document.querySelector('.deck-main').prepend(toolbar);
  };
  phone.addEventListener('change', placeToolbar);
  placeToolbar();
  groupSel.value = store.get('group') in groupings ? store.get('group') : 'type';
  sortSel.value = store.get('sort') in sorters ? store.get('sort') : 'name';

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /** Mana cost like "{2}{W/U}{G/P}" as Mana font symbols; split cards show both halves. */
  const SYMBOLS = { T: 'tap', Q: 'untap', '∞': 'infinity', '½': 'half' };
  function manaCost(cost) {
    const span = el('span', 'cost');
    span.title = cost;
    span.setAttribute('aria-label', 'Mana cost ' + cost);
    cost.split(' // ').forEach((part, i) => {
      if (i) span.append(el('span', 'cost-sep', '//'));
      for (const [, sym] of part.matchAll(/\{([^}]+)\}/g)) {
        const name = SYMBOLS[sym] ?? sym.replace(/\//g, '').toLowerCase();
        span.append(el('i', `ms ms-${name} ms-cost ms-shadow`));
      }
    });
    return span;
  }

  function render() {
    const g = groupings[groupSel.value];
    const groups = new Map();
    cards.forEach((c, i) => {
      if (!c.s) return; // history-only card
      const k = g.key(c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    const keys = [...groups.keys()].sort((a, b) => g.order(a) - g.order(b));
    groupsEl.replaceChildren(...keys.map((k) => {
      const idx = groups.get(k).sort((a, b) => sorters[sortSel.value](cards[a], cards[b]));
      const count = idx.reduce((s, i) => s + cards[i].q, 0);
      let label = g.label(k);
      if ((k === 'Commander') && idx.length > 1) label = 'Commanders';
      const section = el('section', 'group');
      const head = el('h3');
      const btn = el('button');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'true');
      const icon = g.icon?.(k);
      if (icon) {
        const i = el('i', `ms ${icon} ms-fw group-icon`);
        i.setAttribute('aria-hidden', 'true');
        btn.append(i);
      }
      btn.append(label + ' ', el('span', 'count', `(${count})`));
      // The whole heading toggles the group, except "+ N other" next to the arrow.
      const caret = el('span', 'caret');
      caret.setAttribute('aria-hidden', 'true');
      head.append(btn, caret);
      if (groupSel.value === 'type' && k === 'Land') {
        const other = otherLands(count);
        if (other) head.append(other);
      }
      head.addEventListener('click', (e) => {
        if (e.target.closest('.other-lands')) return;
        const collapsed = section.classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
      });
      const list = el('ul', 'cards');
      for (const i of idx) {
        const li = el('li');
        li.dataset.card = i;
        li.append(el('span', 'q', String(cards[i].q)), el('span', 'n', cards[i].n));
        if (cards[i].img2) li.append(faceButton(i));
        if (cards[i].mc) li.append(manaCost(cards[i].mc));
        list.append(li);
      }
      section.append(head, list);
      return section;
    }));
    markActive();
  }

  /** Button after the name of a double-faced card: shows the card and switches between its faces. */
  const FACE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/>' +
    '<path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>';
  function faceButton(i) {
    const b = el('button', 'face-btn');
    b.type = 'button';
    b.title = 'Show other face';
    b.setAttribute('aria-label', `Show other face of ${cards[i].n}`);
    b.innerHTML = FACE_ICON;
    b.addEventListener('click', () => {
      if (focused !== i) setFocus(i);
      flipFace();
    });
    return b;
  }

  /**
   * "+ N other" next to the Lands heading: modal double-faced cards that can be played
   * as a land. The list shows on hover, or on tap on touch screens.
   */
  let closeOtherLands = () => {};
  document.addEventListener('click', (e) => { if (!e.target.closest('.other-lands')) closeOtherLands(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOtherLands(); });

  function otherLands(landCount) {
    const idx = cards.flatMap((c, i) => (c.lf && c.s && c.s !== 'sideboard' ? [i] : []))
      .sort((a, b) => sorters[sortSel.value](cards[a], cards[b]));
    if (!idx.length) return null;
    const count = idx.reduce((s, i) => s + cards[i].q, 0);
    const wrap = el('span', 'other-lands');
    const btn = el('button', 'other-btn', `+ ${count} other`);
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    const pop = el('div', 'other-pop');
    pop.id = 'other-lands-pop';
    btn.setAttribute('aria-controls', pop.id);
    const list = el('ul');
    for (const i of idx) {
      const li = el('li');
      li.dataset.card = i;
      li.append(el('span', 'q', String(cards[i].q)), el('span', 'n', `${cards[i].n} // ${cards[i].lf}`));
      list.append(li);
    }
    const total = el('div', 'pop-total', 'Total lands: ');
    total.append(el('strong', null, String(landCount + count)));
    pop.append(el('div', 'pop-title', 'Other lands'), list, total);
    wrap.append(btn, pop);

    const place = () => {
      // Above the heading like a tooltip, unless there is no room; never past the right edge.
      pop.style.left = '0px';
      pop.classList.remove('below');
      if (pop.getBoundingClientRect().top < 8) pop.classList.add('below');
      const overflow = pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
      if (overflow > 0) pop.style.left = `${-overflow}px`;
    };
    const setOpen = (open) => {
      wrap.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (open) place();
    };
    closeOtherLands = () => setOpen(false);
    wrap.addEventListener('mouseenter', () => { if (hover.matches) setOpen(true); });
    wrap.addEventListener('mouseleave', () => { if (hover.matches) setOpen(false); });
    // With a mouse, hovering already opened it; on touch screens a tap toggles it.
    btn.addEventListener('click', () => setOpen(hover.matches || !wrap.classList.contains('open')));
    return wrap;
  }

  // --- Focused card image ---------------------------------------------------
  let focused = -1;
  let back = false;
  function showImage() {
    const c = cards[focused];
    const src = back && c.img2 ? c.img2 : c.img;
    if (src) {
      img.src = src;
      img.alt = c.n;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
    link.dataset.name = c.n;
    if (c.uri) link.href = c.uri; else link.removeAttribute('href');
    flip.hidden = !c.img2;
    flip.classList.toggle('flipped', back);
    document.querySelectorAll('.face-btn.flipped').forEach((b) => b.classList.remove('flipped'));
    if (back) document.querySelectorAll(`[data-card="${focused}"] .face-btn`).forEach((b) => b.classList.add('flipped'));
  }
  function markActive() {
    document.querySelectorAll('[data-card].active').forEach((e) => e.classList.remove('active'));
    document.querySelectorAll(`[data-card="${focused}"]`).forEach((e) => e.classList.add('active'));
  }
  function setFocus(i) {
    if (i === focused || !cards[i]) return;
    stopFlip(); // switching cards is instant, even in the middle of a flip
    focused = i;
    back = false;
    if (cards[i].img2) new Image().src = cards[i].img2; // preload the back face for a smooth flip
    showImage();
    markActive();
  }

  // Turn the card like in 3D: rotate it edge-on, swap the face, rotate it back into view.
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const PERSPECTIVE = 'perspective(1000px) ';
  let flipRun = 0;
  function stopFlip() {
    flipRun++;
    img.getAnimations().forEach((a) => a.cancel());
  }
  async function flipFace() {
    stopFlip();
    back = !back;
    const run = flipRun;
    if (reducedMotion.matches) return showImage();
    const out = img.animate(
      [{ transform: PERSPECTIVE + 'rotateY(0deg)' }, { transform: PERSPECTIVE + 'rotateY(90deg)' }],
      { duration: 150, easing: 'ease-in', fill: 'forwards' },
    );
    try { await out.finished; } catch { return; } // cancelled
    if (run !== flipRun) return;
    showImage();
    try { await img.decode(); } catch {}
    if (run !== flipRun) return;
    out.cancel();
    img.animate(
      [{ transform: PERSPECTIVE + 'rotateY(-90deg)' }, { transform: PERSPECTIVE + 'rotateY(0deg)' }],
      { duration: 170, easing: 'ease-out' },
    );
  }
  flip.innerHTML = FACE_ICON;
  flip.addEventListener('click', flipFace);

  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  document.addEventListener('mouseover', (e) => {
    if (!hover.matches) return;
    const t = e.target.closest('[data-card]');
    if (t) setFocus(Number(t.dataset.card));
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-card]');
    if (t) setFocus(Number(t.dataset.card));
  });

  groupSel.addEventListener('change', () => { store.set('group', groupSel.value); render(); });
  sortSel.addEventListener('change', () => { store.set('sort', sortSel.value); render(); });

  render();
  const first = cards.findIndex((c) => c.s === 'commander');
  setFocus(first >= 0 ? first : Number(groupsEl.querySelector('[data-card]')?.dataset.card ?? 0));

  // --- Statistics -----------------------------------------------------------
  const statsBody = document.querySelector('#stats .stats-body');
  if (statsBody) renderStats(statsBody, cards.filter((c) => c.s === 'main' || c.s === 'commander'));
})();

function renderStats(container, deck) {
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}, text) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const htmlEl = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;
  const nonland = deck.filter((c) => c.t !== 'Land' && c.t !== 'Unknown');

  // Mana value distribution: nonland cards, 0 … 7+.
  const buckets = Array.from({ length: 8 }, (_, i) => ({ label: i === 7 ? '7+' : String(i), n: 0 }));
  let mvSum = 0;
  let mvCount = 0;
  for (const c of nonland) {
    buckets[Math.min(7, Math.floor(c.mv))].n += c.q;
    mvSum += c.mv * c.q;
    mvCount += c.q;
  }
  const avg = mvCount ? (mvSum / mvCount).toFixed(2) : '–';
  container.append(figure('Mana value', `Nonland cards · average ${avg}`, barChart(buckets)));

  // Card types: every card counted with its quantity, under its main type.
  const TYPES = ['Creature', 'Planeswalker', 'Battle', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Land'];
  const PLURAL = { Creature: 'Creatures', Planeswalker: 'Planeswalkers', Battle: 'Battles', Artifact: 'Artifacts',
    Enchantment: 'Enchantments', Instant: 'Instants', Sorcery: 'Sorceries', Land: 'Lands' };
  const typeCounts = new Map();
  for (const c of deck) {
    const t = TYPES.includes(c.t) ? c.t : 'Other';
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + c.q);
  }
  const typeSlices = [...TYPES, 'Other']
    .filter((t) => typeCounts.get(t))
    .map((t) => ({ label: PLURAL[t] ?? t, n: typeCounts.get(t), color: `var(--type-${t.toLowerCase()})` }));
  container.append(figure('Card types', 'All cards', pieChart(typeSlices, 'cards')));

  // Colors: each copy of a nonland card counts once for every one of its colors.
  const COLORS = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
  const colorCounts = new Map();
  for (const c of nonland) {
    for (const col of c.cl ?? ['C']) colorCounts.set(col, (colorCounts.get(col) ?? 0) + c.q);
  }
  const colorSlices = Object.keys(COLORS)
    .filter((k) => colorCounts.get(k))
    .map((k) => ({ label: COLORS[k], n: colorCounts.get(k), color: `var(--mtg-${k.toLowerCase()})` }));
  container.append(figure('Colors', 'Nonland cards · multicolored cards count for each color',
    pieChart(colorSlices, 'colors')));

  function figure(title, note, body) {
    const fig = htmlEl('figure', 'chart');
    const cap = htmlEl('figcaption');
    cap.append(htmlEl('span', 'chart-title', title), htmlEl('span', 'chart-note', note));
    fig.append(cap, body);
    return fig;
  }

  function barChart(data) {
    const W = 320, H = 170, left = 26, right = 6, top = 16, bottom = 22;
    const max = Math.max(1, ...data.map((d) => d.n));
    const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
    const yMax = Math.ceil(max / step) * step;
    const plotH = H - top - bottom;
    const slot = (W - left - right) / data.length;
    const barW = Math.min(26, slot * 0.62);
    const y = (v) => top + plotH - (v / yMax) * plotH;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bar-chart', role: 'img',
      'aria-label': 'Mana value distribution: ' + data.map((d) => `${d.label}: ${d.n}`).join(', ') });
    for (let v = 0; v <= yMax; v += step) {
      svg.append(svgEl('line', { x1: left, x2: W - right, y1: y(v), y2: y(v), class: v ? 'grid' : 'baseline' }));
      svg.append(svgEl('text', { x: left - 6, y: y(v) + 3.5, class: 'tick', 'text-anchor': 'end' }, v));
    }
    data.forEach((d, i) => {
      const cx = left + slot * i + slot / 2;
      const g = svgEl('g', { class: 'bar' });
      g.append(svgEl('title', {}, `Mana value ${d.label}: ${plural(d.n)}`));
      // Generous hit target behind the visible bar.
      g.append(svgEl('rect', { x: cx - slot / 2, y: top, width: slot, height: plotH, class: 'hit' }));
      if (d.n) {
        const h = (d.n / yMax) * plotH;
        const r = Math.min(4, h, barW / 2);
        const x0 = cx - barW / 2, x1 = cx + barW / 2, yb = y(0), yt = yb - h;
        g.append(svgEl('path', { class: 'mark',
          d: `M${x0},${yb}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x1 - r}Q${x1},${yt} ${x1},${yt + r}V${yb}Z` }));
        g.append(svgEl('text', { x: cx, y: yt - 4, class: 'value', 'text-anchor': 'middle' }, d.n));
      }
      g.append(svgEl('text', { x: cx, y: H - 6, class: 'tick', 'text-anchor': 'middle' }, d.label));
      svg.append(g);
    });
    return svg;
  }

  function pieChart(slices, unit) {
    const wrap = htmlEl('div', 'pie');
    const total = slices.reduce((s, d) => s + d.n, 0);
    const size = 160, c = size / 2, R = 72, r0 = 44;
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'pie-chart', role: 'img',
      'aria-label': slices.map((d) => `${d.label}: ${d.n}`).join(', ') });
    const legend = htmlEl('ul', 'legend');
    const pt = (rad, a) => [c + rad * Math.sin(a), c - rad * Math.cos(a)];
    let a0 = 0;
    for (const d of slices) {
      const pct = Math.round((d.n / total) * 100);
      const g = svgEl('g', { class: 'slice' });
      g.append(svgEl('title', {}, `${d.label}: ${d.n} (${pct}%)`));
      if (slices.length === 1) {
        g.append(svgEl('circle', { cx: c, cy: c, r: (R + r0) / 2, fill: 'none', stroke: d.color,
          'stroke-width': R - r0, class: 'mark ring' }));
      } else {
        const a1 = a0 + (d.n / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
        g.append(svgEl('path', { fill: d.color, class: 'mark',
          d: `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${large} 0 ${x3},${y3}Z` }));
        a0 = a1;
      }
      svg.append(g);
      const li = htmlEl('li');
      const sw = htmlEl('span', 'swatch');
      sw.style.background = d.color;
      li.append(sw, htmlEl('span', 'legend-label', d.label), htmlEl('span', 'legend-value', String(d.n)),
        htmlEl('span', 'legend-pct', `${pct}%`));
      legend.append(li);
      // Hovering a slice or its legend row highlights both.
      const on = () => { wrap.classList.add('hovering'); g.classList.add('hot'); li.classList.add('hot'); };
      const off = () => { wrap.classList.remove('hovering'); g.classList.remove('hot'); li.classList.remove('hot'); };
      for (const e of [g, li]) {
        e.addEventListener('mouseenter', on);
        e.addEventListener('mouseleave', off);
      }
    }
    svg.append(svgEl('text', { x: c, y: c + 2, class: 'pie-total', 'text-anchor': 'middle' }, total));
    svg.append(svgEl('text', { x: c, y: c + 16, class: 'pie-unit', 'text-anchor': 'middle' }, unit));
    wrap.append(svg, legend);
    return wrap;
  }
}
