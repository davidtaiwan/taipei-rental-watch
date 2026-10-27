// Prints a Markdown summary of data/new.json for the "New listings" issue comment.
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const items = JSON.parse(fs.readFileSync(new URL('../data/new.json', import.meta.url), 'utf8')).filter((l) => l.total <= cfg.maxTotal);
if (!items.length) process.exit(0);
const site = process.env.SITE_URL || '';
const nt = (n) => 'NT$' + n.toLocaleString('en-US');
const lines = items.slice(0, 40).map((l) => {
  const st = l.stations.map((s) => `${s.name} ${Math.max(1, Math.round(s.m / 80))} min`).join(', ');
  const extras = [l.balcony && 'balcony', l.dryer && 'dryer', l.gym && 'gym', l.moto && 'scooter parking'].filter(Boolean).join(', ');
  const img = l.photos?.[0] ? `<img src="https://img1.591.com.tw/house/${l.photos[0]}!510x400.jpg" width="160" align="right">` : '';
  return `${img}\n**${nt(l.total)}/mo** · ${l.kind || 'Listing'}${l.ping ? ` · ${l.ping} ping (${l.sqm} m²)` : ''}${l.floor ? ` · floor ${l.floor}` : ''}  \nNear ${st}${extras ? `  \nHas: ${extras}` : ''}  \n[Open on ${l.src}](${l.url})${site ? ` · [See on site](${site}#l${l.id})` : ''}\n<br clear="all">`;
});
console.log(`### ${items.length} new listing${items.length > 1 ? 's' : ''}\n\n${lines.join('\n\n---\n\n')}${items.length > 40 ? `\n\n…and ${items.length - 40} more on the site.` : ''}`);
