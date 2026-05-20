const express = require('express');
const path = require('path');
const RssParser = require('rss-parser');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));

// ==================== Static Files ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/manifest_dash.json', (req, res) => {
  res.set('Content-Type', 'application/manifest+json');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'manifest_dash.json'));
});
app.use(express.static(__dirname));

// ==================== News Sources ====================
const NEWS_SOURCES = [
  { name: '36氪', url: 'https://36kr.com/feed', country: '中国', tags: ['科技', '商业'], cn: true },
  { name: 'CleanTechnica', url: 'https://cleantechnica.com/feed/', country: '美国', tags: ['清洁能源', '电动车'] },
  { name: 'PV Magazine', url: 'https://www.pv-magazine.com/feed/', country: '德国', tags: ['光伏', '新能源'] },
  { name: 'Energy Storage News', url: 'https://www.energy-storage.news/feed/', country: '英国', tags: ['储能', '新能源'] },
  { name: 'Electrek', url: 'https://electrek.co/feed/', country: '美国', tags: ['电动车', '新能源'] },
  { name: 'OilPrice', url: 'https://oilprice.com/rss/main', country: '美国', tags: ['油气', '能源'] },
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

const COUNTRY_RULES = [
  { country: '中国', keys: ['中国', 'china', '北京', '上海', '广东', '深圳', 'chinese'] },
  { country: '美国', keys: ['美国', 'usa', 'us', 'america', 'biden', 'trump', 'united states'] },
  { country: '欧盟', keys: ['欧盟', 'eu', 'europe', 'european', 'brussels'] },
  { country: '德国', keys: ['德国', 'germany', 'berlin', 'german'] },
  { country: '英国', keys: ['英国', 'uk', 'britain', 'united kingdom', 'london'] },
  { country: '日本', keys: ['日本', 'japan', 'tokyo', 'japanese'] },
  { country: '韩国', keys: ['韩国', 'korea', 'south korea', 'seoul'] },
  { country: '印度', keys: ['印度', 'india', 'delhi', 'indian'] },
  { country: '中东', keys: ['中东', 'middle east', 'saudi', 'uae', 'iran', 'iraq'] },
  { country: '俄罗斯', keys: ['俄罗斯', 'russia', 'moscow', 'russian'] },
];

// ==================== News Engine ====================
let newsCache = [];
let newsLastFetch = 0;
const NEWS_TTL = 30 * 60 * 1000;
let fetchInProgress = false;

function extractCountries(text) {
  const countries = new Set();
  for (const rule of COUNTRY_RULES) {
    for (const key of rule.keys) {
      if (text.includes(key)) { countries.add(rule.country); break; }
    }
  }
  return [...countries];
}

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
    const limit = source.cn ? 60 : 15;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36' }
    });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const feed = await parser.parseString(xml);
    const items = [];
    for (const item of (feed.items || []).slice(0, limit)) {
      const itemDate = new Date(item.pubDate || item.isoDate || '');
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (!isNaN(itemDate.getTime()) && itemDate.getTime() < sevenDaysAgo) continue;
      const text = (item.title || '') + ' ' + (item.contentSnippet || '') + ' ' + (item.content || '');
      const countries = extractCountries(text.toLowerCase());
      if (!countries.length && source.country) countries.push(source.country);
      items.push({
        _id: source.name + '|' + (item.link || item.title || Math.random()),
        title: item.title || '',
        link: item.link || '',
        snippet: (item.contentSnippet || item.content || '').replace(/<[^>]+>/g, '').slice(0, 200),
        pubDate: item.pubDate || item.isoDate || '',
        source: source.name,
        country: countries[0] || source.country || '',
        allCountries: countries,
        sourceTags: source.tags,
        tags: tagNewsItem({ title: item.title, contentSnippet: item.contentSnippet || item.content || '' }),
        _keywords: extractKeywords(text),
        _cn: !!source.cn,
      });
    }
    return items;
  } catch (e) { return []; }
}

async function fetchWeiboHotSearch() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
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

function isChineseText(text) {
  if (!text) return false;
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  return cjk > text.length * 0.3;
}

async function translateBatch(items) {
  const needTranslation = [];
  for (const item of items) {
    if (!isChineseText(item.title)) needTranslation.push({ id: item._id, text: item.title, field: 'title' });
    if (item.snippet && !isChineseText(item.snippet)) needTranslation.push({ id: item._id, text: item.snippet, field: 'snippet' });
  }
  if (!needTranslation.length) return;

  const texts = needTranslation.map((t, i) => `[#${i}]\n${t.text}`).join('\n---\n');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (process.env.DEEPSEEK_KEY || '') },
      body: JSON.stringify({
        model: 'deepseek-chat', max_tokens: 4096, temperature: 0.3,
        messages: [{ role: 'user', content: `你是一个专业翻译。将下面的英文文本批量翻译成中文。规则：
1. 每个 [#N] 对应一条待翻译文本
2. 保持原文格式，输出翻译即可，不要额外解释
3. 输出格式：[#N] 然后是翻译后的中文

待翻译文本：
${texts}` }]
      })
    });
    clearTimeout(timeout);
    if (!resp.ok) return;
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const translations = {};
    for (const line of content.split('\n')) {
      const m = line.match(/^\[#(\d+)\]\s*(.+)/);
      if (m) translations[parseInt(m[1])] = m[2].trim();
    }
    for (const t of needTranslation) {
      const trans = translations[needTranslation.indexOf(t)];
      if (trans && trans !== t.text) {
        for (const item of items) {
          if (item._id === t.id) {
            if (t.field === 'title') item.title = trans;
            if (t.field === 'snippet') item.snippet = trans;
          }
        }
      }
    }
  } catch (e) { /* silent */ }
}

async function fetchNews() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  const parser = new RssParser({ timeout: 5000 });
  const allItems = [];
  const results = await Promise.allSettled([
    ...NEWS_SOURCES.map(s => fetchSingleSource(s, parser)),
    fetchWeiboHotSearch()
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length) allItems.push(...r.value);
  }
  const clustered = clusterAndScore(allItems);
  newsCache = clustered;
  newsLastFetch = Date.now();
  translateBatch(clustered);
  fetchInProgress = false;
}

// ==================== API ====================
app.get('/api/news', async (req, res) => {
  const { tag, sort, country, force } = req.query;
  if (!newsCache.length || (Date.now() - newsLastFetch > NEWS_TTL) || force === '1') {
    if (!newsCache.length) {
      await Promise.race([fetchNews(), new Promise(r => setTimeout(r, 8000))]);
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

// ==================== Start ====================
fetchNews();
setInterval(fetchNews, NEWS_TTL);

app.listen(PORT, '0.0.0.0', () => console.log(`Dashboard running on port ${PORT}`));
