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
    deckSort.value = store.get('deckSort') === 'changed' ? 'changed' : 'name';
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
  const groupings = {
    type: {
      key: (c) => special(c) ?? c.t,
      order: (k) => TYPE_ORDER.indexOf(k),
      label: (k) => PLURAL[k] ?? k,
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
  groupSel.value = store.get('group') in groupings ? store.get('group') : 'type';
  sortSel.value = store.get('sort') in sorters ? store.get('sort') : 'name';

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

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
      const btn = el('button', null, label + ' ');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'true');
      btn.append(el('span', 'count', `(${count})`));
      btn.addEventListener('click', () => {
        const collapsed = section.classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
      });
      head.append(btn);
      const list = el('ul', 'cards');
      for (const i of idx) {
        const li = el('li');
        li.dataset.card = i;
        li.append(el('span', 'q', String(cards[i].q)), el('span', 'n', cards[i].n));
        list.append(li);
      }
      section.append(head, list);
      return section;
    }));
    markActive();
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
  }
  function markActive() {
    document.querySelectorAll('[data-card].active').forEach((e) => e.classList.remove('active'));
    document.querySelectorAll(`[data-card="${focused}"]`).forEach((e) => e.classList.add('active'));
  }
  function setFocus(i) {
    if (i === focused || !cards[i]) return;
    focused = i;
    back = false;
    showImage();
    markActive();
  }
  flip.addEventListener('click', () => { back = !back; showImage(); });

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
})();
