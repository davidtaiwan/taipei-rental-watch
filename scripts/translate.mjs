// Adds English translations (titleEn, descEn) to listings that don't have them yet.
// Uses Claude when an ANTHROPIC_API_KEY secret is set; otherwise Google Translate's free web endpoint.
import fs from 'node:fs';

const file = new URL('../data/listings.json', import.meta.url);
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
const KEY = process.env.ANTHROPIC_API_KEY;
const MAX_PER_RUN = +(process.env.MAX_TRANSLATE || 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => [...(s || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7).toString(36);

// Free web translation endpoints, tried in order until one works.
const PROVIDERS = [
  async (q) => {
    const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-TW&tl=en&dt=t&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('gtx ' + r.status);
    return (await r.json())[0].map((x) => x[0]).join('');
  },
  async (q) => {
    const r = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=zh-TW&tl=en&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('dict ' + r.status);
    const j = await r.json();
    return Array.isArray(j) ? j.map((x) => (Array.isArray(x) ? x[0] : x)).join(' ') : (j.sentences || []).map((x) => x.trans || '').join('');
  },
  async (q) => {
    const r = await fetch('https://api.mymemory.translated.net/get?langpair=zh-TW|en&de=listings-bot@users.noreply.github.com&q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('mymemory ' + r.status);
    const j = await r.json();
    if (j.responseStatus !== 200) throw new Error('mymemory ' + j.responseStatus + ' ' + j.responseDetails);
    return j.responseData.translatedText;
  },
];
let pIdx = 0;
const errors = [];
async function google(text) {
  const parts = [];
  let buf = '';
  for (const seg of text.split(/(?<=[。！？!?\n])/)) {
    if ((buf + seg).length > 450) { if (buf) parts.push(buf); buf = seg; } else buf += seg;
  }
  if (buf) parts.push(buf);
  const out = [];
  for (const p of parts) {
    let res = null;
    while (res == null && pIdx < PROVIDERS.length) {
      try { res = await PROVIDERS[pIdx](p); }
      catch (e) { errors.push(e.message); await sleep(1500); try { res = await PROVIDERS[pIdx](p); } catch (e2) { errors.push(e2.message); pIdx++; } }
    }
    if (res == null) throw new Error('all translation providers failed: ' + errors.slice(-3).join('; '));
    out.push(res);
    await sleep(300);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

async function claude(title, desc) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Translate this Taipei rental listing from Traditional Chinese into natural English for a tenant. Keep numbers, prices (NT$), sizes (ping), addresses and phone/LINE IDs exactly. Keep it faithful; do not add information. Reply with JSON only: {"title": "...", "description": "..."}.\n\nTITLE:\n${title}\n\nDESCRIPTION:\n${desc}`,
      }],
    }),
  });
  if (!r.ok) throw new Error('claude ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  const txt = j.content.map((c) => c.text || '').join('');
  const m = txt.match(/\{[\s\S]*\}/);
  const o = JSON.parse(m[0]);
  return { title: o.title, description: o.description };
}

let done = 0, failed = 0;
for (const l of list) {
  if (done >= MAX_PER_RUN) break;
  const src = (l.titleZh || '') + '\n' + (l.descZh || '');
  if (l.descEn != null && l.trHash === hash(src)) continue;
  try {
    if (KEY) {
      const t = await claude(l.titleZh || '', l.descZh || '');
      l.titleEn = t.title; l.descEn = t.description;
    } else {
      l.titleEn = l.titleZh ? await google(l.titleZh) : '';
      l.descEn = l.descZh ? await google(l.descZh) : '';
    }
    l.trBy = KEY ? 'Claude' : ['Google Translate', 'Google Translate', 'MyMemory'][pIdx];
    l.trHash = hash(src);
    done++;
  } catch (e) {
    failed++;
    console.error(`translate ${l.id}: ${e.message}`);
    if (failed >= 5) break; // provider is refusing; try again next run
  }
}
fs.writeFileSync(file, JSON.stringify(list));
const metaFile = new URL('../data/meta.json', import.meta.url);
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
meta.translate = { at: new Date().toISOString(), done, failed, remaining: list.filter((l) => l.descEn == null).length, errors: [...new Set(errors)].slice(-5) };
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
console.log(`Translated ${done} listings (${KEY ? 'Claude' : 'Google Translate'}); ${failed} failed; ${list.filter((l) => l.descEn == null).length} still untranslated.`);
