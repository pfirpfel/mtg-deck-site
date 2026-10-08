const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Encode a site path ("online/My+Deck.html") for use in an href. */
const href = (p) => p.split('/').map(encodeURIComponent).join('/');

/** Relative prefix from a page at `pagePath` back to the site root. */
const rootPrefix = (pagePath) => '../'.repeat(pagePath.split('/').length - 1);

const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

/** Card color indicator for a deck's color identity (WUBRG order), or '' without commanders. */
function identityIcon(identity) {
  if (!identity) return '';
  if (!identity.length) {
    return '<i class="ms ms-c ms-cost ms-shadow identity" title="Colorless" aria-label="Colorless"></i> ';
  }
  const label = identity.map((c) => COLOR_NAMES[c]).join(', ');
  const cls = `ms ms-ci ms-ci-${identity.length} ms-ci-${identity.join('').toLowerCase()} identity`;
  return `<i class="${cls}" title="${label}" aria-label="${label}"></i> `;
}

export const folderPage = (folderPath) => (folderPath ? folderPath + '/index.html' : 'index.html');

function renderTree(folder, ctx, depth = 0) {
  const items = [];
  for (const sub of folder.folders) {
    const open = ctx.current === sub.path || ctx.current.startsWith(sub.path + '/');
    const current = ctx.current === sub.path ? ' aria-current="page"' : '';
    items.push(
      `<li><details${open ? ' open' : ''}><summary><a href="${ctx.root}${href(folderPage(sub.path))}"${current}>${esc(sub.name)}</a></summary>` +
        renderTree(sub, ctx, depth + 1) +
        `</details></li>`,
    );
  }
  for (const deck of folder.decks) {
    const current = ctx.current === deck.file ? ' aria-current="page"' : '';
    items.push(`<li><a class="deck-link" href="${ctx.root}${href(deck.page)}"${current}>${esc(deck.name)}</a></li>`);
  }
  return `<ul${depth === 0 ? ' class="tree"' : ''}>${items.join('')}</ul>`;
}

function renderCrumbs(folderPath, site, root) {
  const parts = folderPath ? folderPath.split('/') : [];
  const links = [`<a href="${root}index.html">${esc(site.title)}</a>`];
  parts.forEach((name, i) => {
    const p = parts.slice(0, i + 1).join('/');
    links.push(`<a href="${root}${href(folderPage(p))}">${esc(name)}</a>`);
  });
  return `<nav class="crumbs" aria-label="Breadcrumb">${links.join('<span class="sep">/</span>')}</nav>`;
}

function layout({ site, pagePath, current, title, titleIcon = '', folderPath, content, docTitle }) {
  const root = rootPrefix(pagePath);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle ?? title)}${docTitle === site.title ? '' : ' · ' + esc(site.title)}</title>
<link rel="icon" href="${root}assets/favicon-32.png" sizes="32x32">
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${root}assets/apple-touch-icon.png">
<link rel="stylesheet" href="${root}assets/mana/css/mana.min.css">
<link rel="stylesheet" href="${root}assets/style.css">
<script>try{if(localStorage.getItem('sidebar')==='hidden')document.documentElement.classList.add('sidebar-hidden')}catch(e){}</script>
</head>
<body>
<div class="layout">
<nav class="sidebar" id="sidebar" aria-label="Decks">
<a class="site-title" href="${root}index.html">${esc(site.title)}</a>
${renderTree(site.tree, { root, current })}
</nav>
<div class="backdrop" data-close-sidebar></div>
<main>
<header class="page-head">
<button class="menu-toggle" type="button" aria-controls="sidebar" aria-label="Toggle deck tree">
<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
</button>
<div>
<h1>${titleIcon}${esc(title)}</h1>
${renderCrumbs(folderPath, site, root)}
</div>
</header>
${content}
</main>
</div>
<script src="${root}assets/app.js" defer></script>
</body>
</html>
`;
}

function deckEntry(deck, root, withFolder = false) {
  const changed = deck.history[0]?.date;
  const meta = deck.commanderNames.join(' + ') || `${deck.count} cards`;
  return (
    `<li${changed ? ` data-changed="${esc(changed)}"` : ''}><a class="entry" href="${root}${href(deck.page)}">` +
    `<span class="entry-name">${identityIcon(deck.identity)}${esc(deck.name)}` +
    (withFolder && deck.folder ? `<span class="entry-folder">${esc(deck.folder)}/</span>` : '') +
    `</span><span class="entry-meta">${esc(meta)}</span>` +
    (changed ? `<time class="entry-date" datetime="${esc(changed)}">${esc(changed.slice(0, 10))}</time>` : '') +
    `</a></li>`
  );
}

export function renderFolderPage(site, folder) {
  const pagePath = folderPage(folder.path);
  const root = rootPrefix(pagePath);
  const folders = folder.folders
    .map(
      (f) =>
        `<li><a class="entry" href="${root}${href(folderPage(f.path))}"><span class="entry-name">${esc(f.name)}/</span>` +
        `<span class="entry-meta">${f.deckCount} deck${f.deckCount === 1 ? '' : 's'}</span></a></li>`,
    )
    .join('');
  const decks = folder.decks.map((d) => deckEntry(d, root)).join('');
  // The home page leads with the most recently changed decks of the whole site.
  const recent =
    !folder.path && site.recent.length
      ? `<h2>Recently updated</h2><ul class="entries recent">${site.recent.map((d) => deckEntry(d, root, true)).join('')}</ul>`
      : '';
  const sortable = folder.decks.length > 1 && folder.decks.some((d) => d.history.length);
  const deckSort = sortable
    ? `<label class="deck-sort">Sort <select id="deck-sort"><option value="changed">Last change</option><option value="name">Name</option></select></label>`
    : '';
  const content = `<div class="folder-view">
${recent}
${folders ? `<h2>Folders</h2><ul class="entries">${folders}</ul>` : ''}
${decks ? `<div class="entries-head"><h2>Decks</h2>${deckSort}</div><ul class="entries" id="decks">${decks}</ul>` : ''}
${!folders && !decks ? '<p class="empty">This folder is empty.</p>' : ''}
</div>`;
  return layout({
    site,
    pagePath,
    current: folder.path,
    title: folder.path ? folder.name : site.title,
    docTitle: folder.path ? folder.name : site.title,
    folderPath: folder.path,
    content,
  });
}

const SECTION_LABEL = { commander: ' (commander)', sideboard: ' (sideboard)', main: '' };

function renderHistory(history, cardIndex, repoUrl) {
  if (!history.length) return '';
  const card = (c, sign) =>
    `<li class="${sign === '+' ? 'add' : 'rem'}" data-card="${cardIndex(c.name)}">` +
    `<span class="q">${sign}${c.qty}</span> <span class="n">${esc(c.name)}</span>${esc(SECTION_LABEL[c.section])}</li>`;
  const entries = history
    .map((h) => {
      const commit = repoUrl
        ? `<a href="${esc(repoUrl)}/commit/${h.hash}">${esc(h.subject)}</a>`
        : esc(h.subject);
      const body = h.created
        ? `<p class="created">Deck created with ${h.count} cards</p>`
        : `<div class="changes">` +
          (h.added.length ? `<ul>${h.added.map((c) => card(c, '+')).join('')}</ul>` : '<ul></ul>') +
          (h.removed.length ? `<ul>${h.removed.map((c) => card(c, '-')).join('')}</ul>` : '') +
          `</div>`;
      return `<li class="change"><div class="change-head"><time datetime="${esc(h.date)}">${esc(h.date.slice(0, 10))}</time> ${commit} <code>${h.hash.slice(0, 7)}</code></div>${body}</li>`;
    })
    .join('');
  return `<details class="panel history"><summary><h2>Changes <span class="count">(${history.length})</span></h2></summary><ol>${entries}</ol></details>`;
}

export function renderDeckPage(site, deck, repoUrl) {
  const pagePath = deck.page;
  // Rendering the history registers history-only cards, so it must happen before serializing.
  const history = renderHistory(deck.history, deck.cardIndex, repoUrl);
  const data =JSON.stringify({ cards: deck.cards }).replace(/</g, '\\u003c');
  const content = `<div class="deck">
<aside class="focus">
<div class="focus-inner">
<div class="focus-card">
<a id="focus-link" target="_blank" rel="noopener"><img id="focus-img" alt=""></a>
<button id="flip" type="button" hidden>Flip</button>
</div>
</div>
</aside>
<section class="deck-main">
<div class="toolbar" id="toolbar">
<span class="total">${deck.count} cards</span>
<label>Group <select id="group">
<option value="type">Type</option>
<option value="mv">Mana value</option>
<option value="color">Color</option>
<option value="none">None</option>
</select></label>
<label>Sort <select id="sort">
<option value="name">Name</option>
<option value="mv">Mana value</option>
</select></label>
</div>
<div id="groups" class="groups"></div>
<noscript><p>Enable JavaScript to view the deck list.</p></noscript>
</section>
<div class="deck-extra">
<details class="panel stats" id="stats"><summary><h2>Statistics</h2></summary><div class="stats-body"></div></details>
${history}
</div>
</div>
<script type="application/json" id="deck-data">${data}</script>`;
  return layout({
    site,
    pagePath,
    current: deck.file,
    title: deck.name,
    titleIcon: identityIcon(deck.identity),
    folderPath: deck.folder,
    content,
  });
}
