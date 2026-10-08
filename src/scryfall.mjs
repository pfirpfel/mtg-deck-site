import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import readline from 'node:readline';

const BULK_ENDPOINT = 'https://api.scryfall.com/bulk-data';
const HEADERS = { 'User-Agent': 'mtg-deck-site/0.1', Accept: 'application/json' };
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Bump when the cached card record format changes, so older caches are rebuilt.
const CACHE_VERSION = 2;
const SKIPPED_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme']);

/** Normalize a card name for lookups: case, diacritics, quotes and split card notation. */
export function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/꞉/g, ':')
    .replace(/\s*\/\/?\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Look up a card by name. Falls back to a unique prefix match, because MTGO
 * truncates long names in exported deck lists.
 */
export function findCard(index, name) {
  const key = normalizeName(name);
  const exact = index.get(key);
  if (exact || key.length < 12) return exact;
  let match;
  for (const [k, record] of index) {
    if (!k.startsWith(key)) continue;
    if (match && match !== record) return undefined;
    match = record;
  }
  return match;
}

/**
 * Returns a Map of normalized card name -> slim card record.
 * The Scryfall bulk files and the derived data are cached in `cacheDir` for 24 hours.
 *
 * Card data comes from `oracle_cards` (one entry per card). `default_cards` (one
 * entry per printing) is only scanned for alternative names, e.g. the Through the
 * Omenpaths names of Marvel cards ("Wrench, Speedway Saboteur" is printed as
 * "Black Cat, Cunning Thief" elsewhere) or Godzilla series names.
 */
export async function loadCardIndex(cacheDir, { log = console.log } = {}) {
  await mkdir(cacheDir, { recursive: true });
  const dataFile = path.join(cacheDir, 'cards.json');
  if (await isFresh(dataFile)) {
    const cached = JSON.parse(await readFile(dataFile, 'utf8'));
    if (cached.version === CACHE_VERSION) {
      log(`Using cached card data (${dataFile})`);
      return buildIndex(cached);
    }
  }

  const records = [];
  const oracleFile = await downloadBulk('oracle-cards', cacheDir, log);
  for await (const card of readCards(oracleFile)) {
    const record = slimCard(card);
    if (record) records.push(record);
  }
  const aliases = new Map();
  const defaultFile = await downloadBulk('default-cards', cacheDir, log);
  for await (const card of readCards(defaultFile)) {
    if (card.lang !== 'en') continue;
    for (const { printed_name, flavor_name } of [card, ...(card.card_faces ?? [])]) {
      for (const alias of [printed_name, flavor_name]) {
        if (alias && !aliases.has(alias)) aliases.set(alias, card.oracle_id ?? card.card_faces?.[0]?.oracle_id);
      }
    }
  }
  const data = { version: CACHE_VERSION, records, aliases: [...aliases] };
  await writeFile(dataFile, JSON.stringify(data));
  // Only the derived data is needed for later builds; keep the cache small.
  await Promise.all([oracleFile, defaultFile].map((f) => rm(f, { force: true })));
  log(`Cached ${records.length} cards and ${aliases.size} alternative names`);
  return buildIndex(data);
}

async function downloadBulk(type, cacheDir, log) {
  const info = await (await fetchOk(`${BULK_ENDPOINT}/${type}`)).json();
  const url = info.jsonl_download_uri ?? info.download_uri;
  const ext = /\.jsonl?(\.gz)?$/.exec(new URL(url).pathname)?.[0] ?? '.json';
  const file = path.join(cacheDir, type + ext);
  log(`Downloading ${url}…`);
  const res = await fetchOk(url);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file + '.part'));
  await rename(file + '.part', file);
  return file;
}

async function isFresh(file) {
  try {
    return Date.now() - (await stat(file)).mtimeMs < MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function fetchOk(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res;
}

async function* readCards(file) {
  let input = createReadStream(file);
  if (file.endsWith('.gz')) input = input.pipe(createGunzip());
  if (file.replace(/\.gz$/, '').endsWith('.jsonl')) {
    for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
      if (line.trim()) yield JSON.parse(line);
    }
  } else {
    const chunks = [];
    for await (const chunk of input) chunks.push(chunk);
    yield* JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
}

function slimCard(card) {
  if (SKIPPED_LAYOUTS.has(card.layout) || card.set_type === 'memorabilia') return null;
  const faces = card.card_faces ?? [];
  const front = faces[0] ?? card;
  return {
    oracle: card.oracle_id ?? faces[0]?.oracle_id,
    name: card.name,
    type: (front.type_line ?? card.type_line ?? '').split(' // ')[0],
    mv: card.cmc ?? 0,
    colors: card.colors ?? front.colors ?? [],
    identity: card.color_identity ?? [],
    // Double-faced cards only have a cost on their faces; split cards list both halves.
    cost: (faces.length && !card.mana_cost ? front.mana_cost : card.mana_cost) || undefined,
    companion: card.keywords?.includes('Companion') || undefined,
    img: card.image_uris?.crop ?? faces[0]?.image_uris?.crop,
    img2: card.image_uris ? undefined : faces[1]?.image_uris?.crop,
    uri: card.scryfall_uri?.split('?')[0],
    faces: faces.length ? faces.map((f) => f.name) : undefined,
  };
}

function buildIndex({ records, aliases }) {
  const index = new Map();
  const byOracle = new Map();
  for (const record of records) {
    index.set(normalizeName(record.name), record);
    byOracle.set(record.oracle, record);
  }
  // Face names ("Fire", "Delver of Secrets") only where they don't clash with a full name.
  for (const record of records) {
    for (const name of [...(record.faces ?? []), record.faces?.join(' // ')]) {
      const key = name && normalizeName(name);
      if (key && !index.has(key)) index.set(key, record);
    }
  }
  // Alternative names keep the card data and image of the regular card, but are
  // displayed under the name used in the deck list.
  for (const [alias, oracle] of aliases) {
    const key = normalizeName(alias);
    const record = byOracle.get(oracle);
    if (record && !index.has(key)) index.set(key, { ...record, name: alias, faces: record.img2 ? [alias] : undefined });
  }
  return index;
}
