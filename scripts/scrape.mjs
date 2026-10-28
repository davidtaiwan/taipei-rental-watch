// Scrapes 591 inside a headless Chromium page, merges results into data/listings.json,
// and writes data/new.json with listings first seen in this run (used for the notification issue).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
// Collect everything up to collectMax; the site's own budget control filters below that.
// maxTotal is the default budget on the site and the limit for issue notifications.
const ceiling = cfg.collectMax || cfg.maxTotal;
const crawler = fs.readFileSync(path.join(root, 'scripts/crawler.js'), 'utf8');
const dataFile = path.join(root, 'data/listings.json');
const metaFile = path.join(root, 'data/meta.json');
const checkedFile = path.join(root, 'data/checked.json');

const now = new Date().toISOString();
const store = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : [];
const checked = fs.existsSync(checkedFile) ? JSON.parse(fs.readFileSync(checkedFile, 'utf8')) : {};
const prevMeta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
// After a budget change, re-read listings we skipped earlier: some may now fit.
const prevCeil = prevMeta.collectMax ?? prevMeta.budget;
if (prevCeil != null && prevCeil !== ceiling) {
  for (const k of Object.keys(checked)) delete checked[k];
  console.log(`Price ceiling changed from ${prevCeil} to ${ceiling}; re-checking skipped listings.`);
}
const byId = new Map(store.map((l) => [l.id, l]));

// Re-check a listing's details at most once every 3 days; skip ids rejected in the last 3 days.
const fresh = (iso) => iso && Date.now() - Date.parse(iso) < 3 * 864e5;
const knownIds = [
  ...store.filter((l) => fresh(l.checkedAt)).map((l) => l.id),
  ...Object.entries(checked).filter(([, iso]) => fresh(iso)).map(([id]) => id),
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  locale: 'zh-TW',
  timezoneId: 'Asia/Taipei',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
});
const page = await ctx.newPage();
await page.goto('https://rent.591.com.tw/list?region=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

const res = await page.evaluate(
  async ({ src, cfg }) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function(src + '; return crawl591;')();
    return fn(cfg);
  },
  {
    src: crawler,
    cfg: {
      ...cfg, maxTotal: ceiling, knownIds,
      cheapMax: cfg.cheap?.max || 0,
      searches: [
        ...cfg.kinds.map((kind) => ({ kind, max: ceiling, cook: true })),
        ...(cfg.cheap ? cfg.cheap.kinds.map((kind) => ({ kind, max: cfg.cheap.max, cook: false })) : []),
      ],
    },
  },
);
await browser.close();

console.log(`591: ${res.listCount} in search, ${res.candidates} under budget, ${res.checked.length} detail pages read, ${res.listings.length} matched`);
if (res.listCount === 0 || res.candidates === 0) {
  console.error('591 returned no results; the site may be blocking this runner. Keeping existing data.');
  process.exit(1);
}

const seen = new Set(res.seenIds);
const fresh591 = [];
for (const l of res.listings) {
  const old = byId.get(l.id);
  if (!old) fresh591.push(l.id);
  const keep = old ? { titleEn: old.titleEn, descEn: old.descEn, trHash: old.trHash, trBy: old.trBy } : {};
  byId.set(l.id, { ...l, ...keep, firstSeen: old?.firstSeen || now, lastSeen: now, checkedAt: now });
}
for (const id of res.checked) if (!res.listings.find((l) => l.id === id)) { checked[id] = now; byId.delete(id); }
for (const l of byId.values()) {
  if (l.src !== '591') continue;
  if (seen.has(l.id)) l.lastSeen = now;
}
// Drop 591 listings that have been gone from the search for 2+ days (rented or removed).
// Also drop anything over the current budget (it may have been lowered).
const out = [...byId.values()].filter((l) => (l.src !== '591' || Date.now() - Date.parse(l.lastSeen) < 2 * 864e5) && l.total <= ceiling && (l.cooking !== false || l.total <= (cfg.cheap?.max || 0)));
out.sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || '') || b.id.localeCompare(a.id));
for (const [id, iso] of Object.entries(checked)) if (!fresh(iso)) delete checked[id];

fs.mkdirSync(path.dirname(dataFile), { recursive: true });
fs.writeFileSync(dataFile, JSON.stringify(out));
fs.writeFileSync(checkedFile, JSON.stringify(checked));
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
meta.lastRun = now;
meta.budget = cfg.maxTotal;
meta.collectMax = ceiling;
meta.sources = { ...(meta.sources || {}), '591': { lastRun: now, inSearch: res.listCount, matched: out.filter((l) => l.src === '591').length } };
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
fs.writeFileSync(path.join(root, 'data/new.json'), JSON.stringify(out.filter((l) => fresh591.includes(l.id))));
console.log(`New this run: ${fresh591.length}. Total on site: ${out.length}`);
