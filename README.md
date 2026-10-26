# Taipei Rental Watch

A small site that lists rental studios and apartments in Taipei near selected MRT stations
(Gongguan, Guting, Taipower Building, CKS Memorial Hall, NTU Hospital, Taipei Main Station,
Dongmen, Zhongshan, Ximen, Da'an, Da'an Park), at or under NT$28,000 per month including fees,
with cooking allowed.

- `index.html`: the site (GitHub Pages).
- `config.json`: search settings (districts, budget, walking radius, stations).
- `scripts/crawler.js`: runs inside a browser page on 591 and extracts matching listings.
- `scripts/scrape.mjs`: runs the crawler in headless Chromium and merges results into `data/`.
- `.github/workflows/update.yml`: runs every 15 minutes and posts new matches to the "New listings" issue.

Photos are shown from the listing sources' own image links.
