const express = require('express');
const RssParser = require('rss-parser');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ==================== News Sources (Chinese new-energy focus) ====================
const NEWS_SOURCES = [
  { name: '36氪', url: 'https://36kr.com/feed', country: '中国', tags: ['科技', '商业', '新能源'], cn: true },
  { name: '华尔街见闻-能源', url: 'https://wallstreetcn.com/tag/能源', country: '中国', tags: ['财经', '能源'], cn: true },
  { name: '东方财富-新能源', url: 'https://finance.eastmoney.com/a/cxny.html', country: '中国', tags: ['财经', '新能源'], cn: true },
  { name: '证券时报-新能源', url: 'https://www.stcn.com/article/list/kj_xny.html', country: '中国', tags: ['财经', '新能源'], cn: true },
  { name: '北极星太阳能光伏网', url: 'https://guangfu.bjx.com.cn/rss.aspx', country: '中国', tags: ['光伏', '新能源'], cn: true },
  { name: '北极星储能网', url: 'https://chuneng.bjx.com.cn/rss.aspx', country: '中国', tags: ['储能', '新能源'], cn: true },
  { name: '北极星风力发电网', url: 'https://fd.bjx.com.cn/rss.aspx', country: '中国', tags: ['风电', '新能源'], cn: true },
  { name: '国际能源网', url: 'https://www.in-en.com/rss/newsrss.aspx', country: '中国', tags: ['能源', '新能源'], cn: true },
  { name: '索比光伏网', url: 'https://news.solarbe.com/rss/', country: '中国', tags: ['光伏', '新能源'], cn: true },
  { name: '高工锂电', url: 'https://www.gg-lb.com/rss/', country: '中国', tags: ['锂电', '新能源'], cn: true },
  { name: '中国能源网', url: 'https://www.china5e.com/rss/', country: '中国', tags: ['能源', '政策'], cn: true },
];

const TAG_RULES = [
  { tag: '光伏', keys: ['solar', '光伏', '太阳能', 'photovoltaic', '硅料', '硅片', '组件'] },
  { tag: '风电', keys: ['wind', '风电', '风机', '海上风电', '陆上风电', 'offshore wind'] },
  { tag: '储能', keys: ['storage', '储能', '电池储能', 'battery storage', 'bess'] },
  { tag: '锂电', keys: ['lithium', '锂电', '锂电池', '锂矿', '碳酸锂', '宁德时代', '比亚迪', 'catl', 'byd'] },
  { tag: '氢能', keys: ['hydrogen', '氢能', '氢燃料', '电解水', '绿氢', '燃料电池'] },
  { tag: '电动车', keys: ['ev', '电动', '电动车', '新能源车', 'tesla', '特斯拉', '蔚来', '小鹏', '理想', '充电桩'] },
  { tag: '油气', keys: ['oil', 'gas', '石油', '天然气', '原油', 'opec', 'lng'] },
  { tag: '核能', keys: ['nuclear', '核能', '核电站', '核电', 'fusion', 'uranium'] },
  { tag: 'AI', keys: ['ai', '人工智能', 'chatgpt', 'gpt', 'llm', '大模型', 'deepseek', 'openai', '深度学习'] },
  { tag: '芯片', keys: ['chip', '芯片', '半导体', 'nvidia', '英伟达', '台积电', 'tsmc', '英特尔'] },
  { tag: '地缘', keys: ['war', '战争', '冲突', '制裁', 'sanction', '关税', 'tariff', '贸易战', '俄乌', '中东', '北约'] },
  { tag: '金融', keys: ['stock', '股市', '股票', 'a股', '港股', '美股', '利率', '加息', '降息', '美联储', '央行', 'crypto', '加密', '比特币'] },
  { tag: '气候', keys: ['climate', '气候', '碳排放', '碳交易', '碳中和', '碳达峰', 'net zero'] },
  { tag: '太空', keys: ['space', '太空', '航天', 'spacex', 'nasa', '火箭', '卫星', '星链'] },
  { tag: '生物', keys: ['医药', '疫苗', '基因', 'crispr', '生物', 'pharma', '癌症'] },
];

// ==================== News Engine ====================
let newsCache = [];
let newsLastFetch = 0;
const NEWS_TTL = 30 * 60 * 1000;
let fetchInProgress = false;

function extractKeywords(text) {
  const stopWords = new Set(['the','and','for','that','this','with','from','have','will','what','when','where','which','about','their','they']);
  const words = text.toLowerCase().replace(/[^\w\s一-鿿]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
  const cnWords = text.match(/[一-鿿]{2,}/g) || [];
  return [...new Set([...words, ...cnWords])].slice(0, 20);
}

function tagNewsItem(item) {
  const text = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
  const tags = [];
  for (const rule of TAG_RULES) {
    for (const key of rule.keys) {
      if (text.includes(key)) { tags.push(rule.tag); break; }
    }
  }
  return [...new Set(tags)];
}

function clusterAndScore(items) {
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const cluster = [items[i]];
    used.add(i);
    const kwi = new Set(items[i]._keywords || []);
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const kwj = new Set(items[j]._keywords || []);
      if ([...kwi].filter(k => kwj.has(k)).length >= 3) {
        cluster.push(items[j]);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }
  const result = [];
  for (const cluster of clusters) {
    const cnBoost = cluster.some(i => i._cn) ? 1 : 0;
    const weiboHeat = cluster.reduce((s, i) => s + (i._heatBase || 0), 0);
    const heat = cluster.length + cnBoost + weiboHeat;
    const best = cluster.slice(0, 2);
    for (const item of best) result.push({ ...item, heat });
  }
  return result;
}

async function fetchSingleSource(source, parser) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36' }
    });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const feed = await parser.parseString(xml);
    const items = [];
    for (const item of (feed.items || []).slice(0, source.cn ? 30 : 10)) {
      const itemDate = new Date(item.pubDate || item.isoDate || '');
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (!isNaN(itemDate.getTime()) && itemDate.getTime() < sevenDaysAgo) continue;
      const text = (item.title || '') + ' ' + (item.contentSnippet || '') + ' ' + (item.content || '');
      items.push({
        _id: source.name + '|' + (item.link || item.title || Math.random()),
        title: item.title || '',
        link: item.link || '',
        snippet: (item.contentSnippet || item.content || '').replace(/<[^>]+>/g, '').slice(0, 200),
        pubDate: item.pubDate || item.isoDate || '',
        source: source.name,
        country: source.country || '',
        allCountries: [source.country || ''],
        sourceTags: source.tags,
        tags: tagNewsItem({ title: item.title, contentSnippet: item.contentSnippet || item.content || '' }),
        _keywords: extractKeywords(text),
        _cn: true,
      });
    }
    return items;
  } catch (e) { return []; }
}

async function fetchWeiboHotSearch() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch('https://weibo.com/ajax/side/hotSearch', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Referer': 'https://weibo.com/'
      }
    });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const data = await resp.json();
    const topics = data?.data?.realtime || [];
    const items = [];
    const now = new Date().toISOString();
    for (const t of topics.slice(0, 50)) {
      if (!t.word) continue;
      const text = t.word + ' ' + (t.note || '');
      const tags = tagNewsItem({ title: t.word, contentSnippet: t.note || '' });
      items.push({
        _id: '微博热搜|' + t.word,
        title: t.word,
        link: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(t.word),
        snippet: (t.note || '').slice(0, 200),
        pubDate: now,
        source: '微博热搜',
        country: '中国',
        allCountries: ['中国'],
        sourceTags: ['热搜', '实时'],
        tags: tags.length ? tags : ['热议'],
        _keywords: extractKeywords(text),
        _cn: true,
        _heatBase: Math.round((t.num || 100000) / 100000),
      });
    }
    return items;
  } catch (e) { return []; }
}

async function fetchNews() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  const parser = new RssParser({ timeout: 3000 });
  const allItems = [];
  // Fetch Weibo first (fastest), then RSS sources
  const results = await Promise.allSettled([
    fetchWeiboHotSearch(),
    ...NEWS_SOURCES.map(s => fetchSingleSource(s, parser))
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length) allItems.push(...r.value);
  }
  const clustered = clusterAndScore(allItems);
  newsCache = clustered;
  newsLastFetch = Date.now();
  fetchInProgress = false;
}

// ==================== API ====================
app.get('/api/news', async (req, res) => {
  const { tag, sort, country, force } = req.query;
  if (!newsCache.length || (Date.now() - newsLastFetch > NEWS_TTL) || force === '1') {
    if (!newsCache.length) {
      await Promise.race([fetchNews(), new Promise(r => setTimeout(r, 7000))]);
    } else {
      fetchNews();
    }
  }
  let items = [...newsCache];
  if (tag) items = items.filter(i => i.tags.includes(tag));
  if (country) items = items.filter(i => i.country === country || (i.allCountries || []).includes(country));
  if (sort === 'time') {
    items.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  } else {
    items.sort((a, b) => (b.heat || 0) - (a.heat || 0) || (new Date(b.pubDate || 0) - new Date(a.pubDate || 0)));
  }
  res.json({
    items: items.slice(0, 200),
    allTags: [...new Set(newsCache.flatMap(i => i.tags))].sort(),
    allCountries: [...new Set(newsCache.flatMap(i => i.allCountries || []))].sort(),
    fetchedAt: newsLastFetch,
  });
});

// Warm cache on first import
fetchNews();

module.exports = app;
