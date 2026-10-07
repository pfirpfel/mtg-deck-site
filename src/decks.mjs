import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRS = new Set(['node_modules']);
const LINE = /^(\d+)x?\s+(.+?)\s*$/i;
const SIDEBOARD_HEADER = /^sideboard:?$/i;

/** Recursively find deck list files (*.txt) below `root`, skipping dot dirs and `exclude`. */
export async function findDeckFiles(root, exclude = []) {
  const excluded = exclude.map((p) => path.resolve(p));
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
        if (excluded.includes(path.resolve(full))) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) {
        files.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
  await walk(root);
  return files.sort();
}

/**
 * Parse a deck list in MTGO text format.
 * Main deck and sideboard are separated by an empty line. A sideboard of 3 or
 * fewer cards is treated as the commander(s) (and possibly a companion).
 */
export function parseDeck(text) {
  const blocks = [[]];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || SIDEBOARD_HEADER.test(line)) {
      if (blocks.at(-1).length) blocks.push([]);
      continue;
    }
    const m = LINE.exec(line);
    if (!m) continue;
    blocks.at(-1).push({ qty: Number(m[1]), name: cleanName(m[2]) });
  }
  if (!blocks.at(-1).length) blocks.pop();
  // Some lists put the commander(s) first: a small leading block followed by the main deck.
  if (blocks.length === 2 && count(blocks[0]) <= 3 && count(blocks[1]) > 3) blocks.reverse();
  const main = blocks[0] ?? [];
  const side = blocks.slice(1).flat();
  const sideCount = count(side);
  const isCommander = sideCount > 0 && sideCount <= 3;
  return {
    main,
    commanders: isCommander ? side : [],
    sideboard: isCommander ? [] : side,
  };
}

const count = (cards) => cards.reduce((sum, c) => sum + c.qty, 0);

/** Unify split card notation: "Fire/Ice" and "Fire // Ice" both become "Fire // Ice". */
export function cleanName(name) {
  return name.replace(/\s*\/\/?\s*/g, ' // ').replace(/\s+/g, ' ').trim();
}

export function deckDisplayName(file) {
  return path.posix.basename(file).replace(/\.txt$/i, '').replace(/_/g, ' ');
}

export async function readDeck(root, file) {
  return parseDeck(await readFile(path.join(root, file), 'utf8'));
}
