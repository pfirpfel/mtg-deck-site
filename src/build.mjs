#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findDeckFiles, readDeck, deckDisplayName } from './decks.mjs';
import { loadCardIndex, normalizeName, findCard } from './scryfall.mjs';
import { gitRoot, guessRepoUrl, deckHistory, mapLimit, trackedFiles, isShallow } from './history.mjs';
import { renderDeckPage, renderFolderPage, folderPage } from './render.mjs';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const { values: opts } = parseArgs({
  options: {
    decks: { type: 'string', default: '.' },
    out: { type: 'string', default: '_site' },
    cache: { type: 'string', default: '.cache/scryfall' },
    title: { type: 'string' },
    'root-name': { type: 'string' },
    'repo-url': { type: 'string' },
    'no-history': { type: 'boolean', default: false },
  },
});

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Land', 'Artifact', 'Enchantment', 'Instant', 'Sorcery'];
const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

function cardType(typeLine) {
  return TYPE_ORDER.find((t) => typeLine.includes(t)) ?? (typeLine ? 'Other' : 'Unknown');
}

function cardColor(card) {
  if (card.type.includes('Land')) return 'Land';
  if (card.colors.length > 1) return 'Multicolor';
  return COLOR_NAMES[card.colors[0]] ?? 'Colorless';
}

function buildTree(decks) {
  const root = { name: '', path: '', folders: [], decks: [], deckCount: 0 };
  const byPath = new Map([['', root]]);
  const getFolder = (p) => {
    if (byPath.has(p)) return byPath.get(p);
    const parent = getFolder(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    const folder = { name: p.split('/').at(-1), path: p, folders: [], decks: [], deckCount: 0 };
    parent.folders.push(folder);
    byPath.set(p, folder);
    return folder;
  };
  for (const deck of decks) {
    let folder = getFolder(deck.folder);
    folder.decks.push(deck);
    for (let p = deck.folder; ; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
      byPath.get(p).deckCount++;
      if (!p) break;
    }
  }
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  for (const folder of byPath.values()) {
    folder.folders.sort((a, b) => collator.compare(a.name, b.name));
    folder.decks.sort((a, b) => collator.compare(a.name, b.name));
  }
  return { root, folders: [...byPath.values()] };
}

async function main() {
  const deckRoot = path.resolve(opts.decks);
  const outDir = path.resolve(opts.out);
  const gitDir = await gitRoot(deckRoot);
  let files = await findDeckFiles(deckRoot, [outDir, path.resolve(opts.cache)]);
  if (gitDir) {
    const tracked = await trackedFiles(deckRoot);
    files = files.filter((f) => tracked.has(f));
  }
  console.log(`Found ${files.length} deck files in ${deckRoot}`);

  const index = await loadCardIndex(path.resolve(opts.cache));
  const repoRoot = opts['no-history'] ? null : gitDir;
  if (repoRoot && (await isShallow(repoRoot))) {
    console.warn('Warning: shallow git clone, the deck history is incomplete. Check out with `fetch-depth: 0`.');
  }
  const repoUrl = opts['repo-url'] ?? (gitDir ? await guessRepoUrl(gitDir) : null);
  const missing = new Set();

  const decks = await mapLimit(files, 8, async (file) => {
    const parsed = await readDeck(deckRoot, file);
    const cards = [];
    const indexByName = new Map();
    const addCard = (name, qty, section) => {
      const record = findCard(index, name);
      if (!record) missing.add(name);
      const type = cardType(record?.type ?? '');
      const card = {
        q: qty,
        // Double-faced cards are listed by their front face, like in MTGO.
        n: (record?.img2 ? record.faces[0] : record?.name) ?? name,
        s: section,
        t: type,
        mv: record?.mv ?? 0,
        c: record ? cardColor(record) : 'Colorless',
        cl: record?.colors.length ? record.colors : undefined,
        mc: record?.cost,
        lf: record?.landFace,
        img: record?.img,
        img2: record?.img2,
        uri: record?.uri,
      };
      indexByName.set(normalizeName(name), cards.length);
      cards.push(card);
    };
    const commanderRecords = parsed.commanders.map((c) => findCard(index, c.name));
    const hasNonCompanion = commanderRecords.some((r) => !r?.companion);
    parsed.commanders.forEach((c, i) =>
      addCard(c.name, c.qty, commanderRecords[i]?.companion && hasNonCompanion ? 'companion' : 'commander'),
    );
    parsed.main.forEach((c) => addCard(c.name, c.qty, 'main'));
    parsed.sideboard.forEach((c) => addCard(c.name, c.qty, 'sideboard'));

    const relToRepo = repoRoot ? path.relative(repoRoot, path.join(deckRoot, file)).split(path.sep).join('/') : null;
    const history = relToRepo ? await deckHistory(repoRoot, relToRepo) : [];
    // Cards that only appear in the history get an entry too, so hovering them shows the image.
    const cardIndex = (name) => {
      const key = normalizeName(name);
      if (!indexByName.has(key)) addCard(name, 0, null);
      return indexByName.get(key);
    };

    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    return {
      file,
      folder,
      page: file.replace(/\.txt$/i, '.html'),
      name: deckDisplayName(file),
      commanderNames: cards.filter((c) => c.s === 'commander').map((c) => c.n),
      // Color identity as defined by the commanders; null for decks without commanders.
      identity: parsed.commanders.length
        ? 'WUBRG'.split('').filter((col) => commanderRecords.some((r) => r?.identity.includes(col)))
        : null,
      count: cards.reduce((sum, c) => sum + (c.s && c.s !== 'sideboard' ? c.q : 0), 0),
      cards,
      history,
      cardIndex,
    };
  });

  const nonEmpty = decks.filter((d) => d.count > 0);
  const tree = buildTree(nonEmpty);
  const lastChange = (deck) => Date.parse(deck.history[0]?.date) || 0;
  const recent = nonEmpty
    .filter(lastChange)
    .sort((a, b) => lastChange(b) - lastChange(a))
    .slice(0, 10);
  // The site title (browser tab, home page heading) and the root folder's name (first breadcrumb).
  const rootName = opts['root-name'] ?? opts.title ?? path.basename(repoRoot ?? deckRoot);
  const site = { title: opts.title ?? rootName, rootName, recent };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(ASSETS, path.join(outDir, 'assets'), { recursive: true });
  await writeFile(path.join(outDir, '.nojekyll'), '');

  const write = async (page, html) => {
    const target = path.join(outDir, ...page.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html);
  };
  for (const deck of nonEmpty) await write(deck.page, renderDeckPage(site, deck, repoUrl));
  for (const folder of tree.folders) await write(folderPage(folder.path), renderFolderPage(site, folder));

  if (missing.size) console.warn(`Cards not found on Scryfall (${missing.size}): ${[...missing].sort().join(', ')}`);
  console.log(`Wrote ${nonEmpty.length} decks and ${tree.folders.length} folders to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
