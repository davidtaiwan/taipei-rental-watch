// Runs inside a real browser page on https://rent.591.com.tw (Playwright or Chrome).
// Returns { listCount, listings[] } for listings that match the search config.
// 591 ignores query filters for non-browser requests, so this must run in a page context.
async function crawl591(CFG) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => (s == null ? null : +String(s).replace(/[^\d.]/g, '') || null);
  const norm = (s) => s.replace(/臺/g, '台').replace(/^捷運/, '').replace(/\(.*?\)|（.*?）/g, '').trim().replace(/車站$/, '車站').replace(/(?<!車)站$/, '');
  const ST = CFG.stations; // { '公館': 'Gongguan', ... }

  async function getHTML(url, tries = 3) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (r.ok) return await r.text();
      } catch (e) {}
      await sleep(1500 * (i + 1));
    }
    throw new Error('fetch failed ' + url);
  }
  const parse = (h) => new DOMParser().parseFromString(h, 'text/html');

  // ---------- list pages ----------
  async function listPage(base, firstRow) {
    const d = parse(await getHTML(base + '&firstRow=' + firstRow));
    const cnt = num((d.body.textContent.match(/已為你找到\s*([\d,]+)/) || [])[1]) || 0;
    const items = [...d.querySelectorAll('.item')].map((it) => {
      const a = it.querySelector('a.link');
      return {
        id: ((a && a.getAttribute('href')) || '').match(/(\d{7,})/)?.[1],
        title: a ? a.textContent.trim() : '',
        tags: [...it.querySelectorAll('.tag')].map((t) => t.textContent.trim()),
        leaf: [...it.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => e.textContent.trim()).filter(Boolean),
      };
    }).filter((x) => x.id);
    return { cnt, items };
  }
  const cards = new Map();
  let listCount = 0;
  for (const kind of CFG.kinds) {
    const base = `https://rent.591.com.tw/list?region=1&section=${CFG.sections}&kind=${kind}&price=0_${CFG.maxTotal}&other=cook&sort=posttime_desc`;
    const p0 = await listPage(base, 0);
    listCount += p0.cnt;
    p0.items.forEach((x) => cards.set(x.id, x));
    const pages = Math.min(Math.ceil(p0.cnt / 30), CFG.maxPages);
    for (let p = 1; p < pages; p++) {
      const r = await listPage(base, p * 30);
      r.items.forEach((x) => cards.set(x.id, x));
      await sleep(CFG.delayMs);
    }
  }

  function cardMoney(x) {
    const L = x.leaf;
    const i = L.findIndex((s) => s === '元/月');
    const rent = num(L[i - 1]);
    const extra = L.find((s) => /額外費用/.test(s));
    const extraN = extra ? num((extra.match(/([\d,]+)元/) || [])[1]) : 0;
    const tot = (L.find((s) => /合計/.test(s)) || '').match(/([\d,]+)元/);
    return { rent, total: tot ? num(tot[1]) : rent + (extraN || 0) };
  }
  const pre = [...cards.values()].map((x) => ({ ...x, ...cardMoney(x) })).filter((x) => x.rent && x.total <= CFG.maxTotal);

  // ---------- detail pages ----------
  const skip = new Set(CFG.knownIds || []);
  const KIND = { '整層住家': 'Entire apartment', '獨立套房': 'Private studio', '分租套房': 'Studio in shared flat' };
  const BLD = { '公寓': 'Walk-up', '電梯大樓': 'Elevator building', '華廈': 'Mid-rise with elevator', '透天厝': 'Townhouse', '別墅': 'Villa' };
  const DIST = { '中正區': 'Zhongzheng', '大同區': 'Datong', '中山區': 'Zhongshan', '大安區': "Da'an", '萬華區': 'Wanhua' };
  const INC = { '水費': 'water', '電費': 'electricity', '網路': 'internet', '第四台': 'cable TV', '第四臺': 'cable TV', '瓦斯費': 'gas', '管理費': 'management fee', '清潔費': 'cleaning', '車位租金': 'parking' };
  const FAC = { '冰箱': 'Fridge', '洗衣機': 'Washing machine', '電視': 'TV', '冷氣': 'Air conditioning', '熱水器': 'Water heater', '床': 'Bed', '衣櫃': 'Wardrobe', '第四台': 'Cable TV', '網路': 'Internet', '天然瓦斯': 'Natural gas', '沙發': 'Sofa', '桌椅': 'Table & chairs', '陽台': 'Balcony', '電梯': 'Elevator', '車位': 'Parking space' };
  const TAG = { '新上架': 'New', '租金補貼': 'Rent subsidy OK', '可報稅': 'Tax-deductible', '近商圈': 'Near shops', '可入籍': 'Household registration OK', '可短租': 'Short lease OK', '免服務費': 'No agent fee', '社會住宅': 'Social housing', '屋主直租': 'Owner lists directly', '押一付一': '1-month deposit', '免押金': 'No deposit', '影片賞屋': 'Video tour', '高齡友善': 'Senior friendly', '拎包入住': 'Fully furnished', '可養寵物': 'Pets OK' };

  function detail(p, h) {
    const d = parse(h);
    const trafficTxt = [...d.querySelectorAll('.surround-list-box.traffic')]
      .flatMap((b) => [...b.parentElement.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => e.textContent.trim()))
      .join(' ');
    const fac = [...d.querySelectorAll('dl')].filter((dl) => dl.querySelector('i.ic-house') && dl.querySelector('dd'))
      .map((dl) => ({ n: dl.querySelector('dd').textContent.trim(), on: !dl.classList.contains('del') }));
    const photos = [...new Set((h.match(/https?:\/\/img\d\.591\.com\.tw\/house\/\d{4}\/[^"'\s\\)]+?!1000x[^"'\s\\)]*/g) || [])
      .map((u) => u.replace(/^https?:\/\/img\d\.591\.com\.tw\/house\//, '').replace(/!.*$/, '')))];
    d.querySelectorAll('script,style,noscript,svg').forEach((e) => e.remove());
    const t = d.body.textContent.replace(/\s+/g, ' ');
    const seg = (a, b, max = 800) => { const i = t.indexOf(a); if (i < 0) return ''; const j = b ? t.indexOf(b, i + a.length) : -1; return t.slice(i + a.length, j < 0 ? i + a.length + max : j).trim(); };
    const head = seg('數字App', '位置與周邊'), addr = seg('地址:', '交通', 80), rules = seg('租住說明', '提供設備'),
      desc = seg('屋況介紹', '房屋詳情', 3000), info = seg('房屋詳情', '房屋價格'), price = seg('房屋價格', '詳情');
    const all = [head, rules, info, desc].join(' ');

    // stations within radius
    const st = {};
    const add = (n, m) => { n = norm(n); if (ST[n] && m <= CFG.radius && (!(n in st) || st[n] > m)) st[n] = m; };
    trafficTxt.replace(/(\S+?)\s*(\d+)(?=\s|$)/g, (_, n, m) => add(n, +m));
    const L = p.leaf, li = L.findIndex((s) => s.startsWith('距'));
    if (li >= 0) add(L[li].slice(1), num(L[li + 1]) || 99999);
    const stations = Object.entries(st).sort((a, b) => a[1] - b[1]).map(([zh, m]) => ({ name: ST[zh], zh, m }));

    const kz = Object.keys(KIND).find((k) => head.includes(k));
    const lay = (head.match(/(\d房\d廳(\d衛)?)/) || [])[1] || '';
    const ping = num((head.match(/([\d.]+)坪/) || [])[1]);
    const floor = (head.match(/坪\s*(\S+?\/\S+?F)/) || [])[1] || '';
    const bz = Object.keys(BLD).find((k) => head.includes(k));
    const fee = num((price.match(/管理費([\d,]+)元/) || [])[1]) || 0;
    const extra = num((head.match(/額外費用([\d,]+)元/) || [])[1]) || 0;
    const incZ = (price.match(/租金含(.+?)(?:仲介|屋主|代理人|$)/) || head.match(/租金包含([^，,]+)/) || [])[1] || '';
    const inc = [...new Set(Object.keys(INC).filter((k) => incZ.includes(k)).map((k) => INC[k]))];
    const dep = ((price.match(/押金(\S{1,5}?)(?:服務費|管理費|租金|$)/) || [])[1] || '')
      .replace('一個月', '1 month').replace(/[二兩]個月/, '2 months').replace('三個月', '3 months').replace('面議', 'Negotiable');
    const lease = ((rules.match(/最短租期(.+?)(身份|可遷入|性別|養寵物|開伙|$)/) || [])[1] || '')
      .replace('一年', '1 year').replace('半年', '6 months').replace(/(\d+)個月/, '$1 months').replace(/(\d+)年/, '$1 years').replace('不限', 'Any');
    const facOn = fac.filter((f) => f.on).map((f) => FAC[f.n] || f.n);
    const facOff = fac.filter((f) => !f.on).map((f) => FAC[f.n] || f.n);
    const noWin = /無窗|無對外窗|沒有窗|暗房|無採光/.test(all);
    const total = p.rent + (inc.includes('management fee') ? extra : (extra || fee));
    const who = L.find((s) => /^(仲介|屋主|代理人)/.test(s)) || '';
    return {
      id: p.id, src: '591', url: 'https://rent.591.com.tw/' + p.id, titleZh: p.title,
      kind: KIND[kz] || '', layout: lay.replace(/(\d)房/, '$1 bed · ').replace(/(\d)廳/, '$1 living · ').replace(/(\d)衛/, '$1 bath').replace(/ · $/, ''),
      ping, sqm: ping ? Math.round(ping * 3.3058) : null, floor, building: BLD[bz] || '',
      rent: p.rent, fees: inc.includes('management fee') ? extra : (extra || fee), total,
      includes: inc, deposit: dep, agentFee: /不收服務費|免服務費/.test(price + head) ? 'No' : /收取服務費|收服務費/.test(price) ? 'Yes' : '',
      district: DIST[(addr.match(/^(\S+?區)/) || [])[1]] || '', addressZh: addr.slice(0, 60), stations,
      lease, gender: /限女/.test(rules) ? 'Women only' : /限男/.test(rules) ? 'Men only' : /男女皆可/.test(rules) ? 'Anyone' : '',
      pets: /不可養寵物/.test(rules) ? 'No' : /可養寵物/.test(rules) ? 'Yes' : '',
      age: num((info.match(/屋齡(\d+)年/) || [])[1]),
      legalUse: /法定用途住家用/.test(info) ? 'Residential' : /法定用途商業用/.test(info) ? 'Commercial' : '',
      facilities: facOn, missing: facOff,
      kitchen: /廚房|流理台|廚具|電磁爐|瓦斯爐|感應爐|IH爐|爐台|廚櫃/.test(all) || facOn.includes('Natural gas'),
      window: !noWin && /窗|採光|日照|陽光/.test(all), noWindow: noWin,
      balcony: facOn.includes('Balcony') || /有陽台|陽台\d/.test(info + head),
      dryer: /烘衣|烘乾|洗脫烘|乾衣機|洗烘/.test(all), gym: /健身/.test(all), moto: /機車/.test(all),
      tags: p.tags.map((x) => TAG[x]).filter(Boolean), lister: who.startsWith('屋主') ? 'Owner' : who ? 'Agent' : '',
      postedZh: (t.match(/此房屋在(.{1,12}?)發佈/) || [])[1] || '',
      photos: photos.slice(0, 12), descZh: desc.replace(/\s+/g, ' ').slice(0, 2000),
    };
  }

  const out = [], checked = [];
  const todo = pre.filter((p) => !skip.has(p.id));
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const p = todo[i++];
      try {
        const r = detail(p, await getHTML('https://rent.591.com.tw/' + p.id));
        checked.push(p.id);
        if (r.stations.length && !r.noWindow && r.total <= CFG.maxTotal) out.push(r);
      } catch (e) {}
      await sleep(CFG.delayMs);
    }
  }
  await Promise.all(Array.from({ length: CFG.concurrency }, worker));
  return { listCount, candidates: pre.length, seenIds: pre.map((p) => p.id), checked, listings: out };
}
