# Taipei Rental Watch

A small site that lists rental studios and apartments in Taipei near selected MRT stations
(Gongguan, Guting, Taipower Building, CKS Memorial Hall, NTU Hospital, Taipei Main Station,
Dongmen, Zhongshan, Ximen, Da'an, Da'an Park, plus Wenshan District's Wanlong, Jingmei, Xinhai, Wanfang Hospital, Wanfang Community, Muzha and Taipei Zoo), at or under NT$28,000 per month including fees,
with cooking allowed.

- `index.html`: the site (GitHub Pages).
- `config.json`: search settings. `collectMax` is the highest monthly cost collected (NT$40,000); `maxTotal` is the default budget on the site and the limit for "New listings" notifications (change it with the "Change notification budget" workflow). Each browser sets its own budget on the page.
- `scripts/crawler.js`: runs inside a browser page on 591 and extracts matching listings.
- `scripts/scrape.mjs`: runs the crawler in headless Chromium and merges results into `data/`.
- `.github/workflows/update.yml`: a long-running job checks every 15 minutes and starts its next round itself (GitHub's own schedule is too irregular for 15 minutes); new matches go to the "New listings" issue. Run it by hand for a single immediate check.

Photos are shown from the listing sources' own image links.
