const RssParser = require('rss-parser');

const NEWS_SOURCES = [
  { name: '36氪', url: 'https://36kr.com/feed', tags: ['科技', '商业', '新能源'] },
  { name: '36氪快讯', url: 'https://rsshub.rssforever.com/36kr/newsflashes', tags: ['科技', '快讯', '实时'] },
  { name: '华尔街见闻', url: 'https://rsshub.rssforever.com/wallstreetcn/news/global', tags: ['财经', '能源', '政策'] },
  { name: '财联社', url: 'https://rsshub.rssforever.com/cls/depth/1000', tags: ['财经', '能源', '深度'] },
  { name: '联合早报', url: 'https://rsshub.rssforever.com/zaobao/realtime/china', tags: ['中国', '时政', '财经'] },
  { name: '财新网', url: 'https://rsshub.rssforever.com/caixin/latest', tags: ['财经', '政策', '能源'] },
  { name: '东方财富-光伏', url: 'https://rsshub.rssforever.com/eastmoney/search/%E5%85%89%E4%BC%8F', tags: ['光伏', '新能源', '财经'] },
  { name: '东方财富-储能', url: 'https://rsshub.rssforever.com/eastmoney/search/%E5%82%A8%E8%83%BD', tags: ['储能', '新能源', '财经'] },
  { name: '东方财富-风电', url: 'https://rsshub.rssforever.com/eastmoney/search/%E9%A3%8E%E7%94%B5', tags: ['风电', '新能源', '财经'] },
  { name: 'PV Magazine', url: 'https://www.pv-magazine.com/feed/', tags: ['光伏', '新能源', '国际'] },
  { name: '南方能源建设', url: 'https://www.energychina.press/rss/current.xml', tags: ['能源', '学术', '工程'] },
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

function extractKeywords(text) {
  const cn = text.match(/[一-鿿]{2,}/g) || [];
  const en = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  return [...new Set([...en, ...cn])].slice(0, 20);
}

function tagNewsItem(title, snippet) {
  const text = (title + ' ' + (snippet || '')).toLowerCase();
  const tags = [];
  for (const rule of TAG_RULES) {
    for (const key of rule.keys) {
      if (text.includes(key)) { tags.push(rule.tag); break; }
    }
  }
  return [...new Set(tags)];
}

function clusterAndScore(items) {
  const clusters = [], used = new Set();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const cluster = [items[i]]; used.add(i);
    const kwi = new Set(items[i]._keywords || []);
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const kwj = new Set(items[j]._keywords || []);
      if ([...kwi].filter(k => kwj.has(k)).length >= 3) { cluster.push(items[j]); used.add(j); }
    }
    clusters.push(cluster);
  }
  const result = [];
  for (const cluster of clusters) {
    const heat = cluster.length + (cluster.some(i => i._cn) ? 1 : 0);
    for (const item of cluster.slice(0, 2)) result.push({ ...item, heat });
  }
  return result;
}

async function fetchSource(source, parser) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(source.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36' }
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const feed = await parser.parseString(xml);
    const items = [];
    for (const item of (feed.items || []).slice(0, 30)) {
      const d = new Date(item.pubDate || item.isoDate || '');
      if (!isNaN(d.getTime()) && d.getTime() < Date.now() - 7 * 86400000) continue;
      const text = (item.title || '') + ' ' + (item.contentSnippet || '') + ' ' + (item.content || '');
      const tags = tagNewsItem(item.title || '', item.contentSnippet || '');
      items.push({
        _id: source.name + '|' + (item.link || item.title || Math.random()),
        title: item.title || '', link: item.link || '',
        snippet: (item.contentSnippet || item.content || '').replace(/<[^>]+>/g, '').slice(0, 200),
        pubDate: item.pubDate || item.isoDate || '', source: source.name,
        country: '中国', allCountries: ['中国'],
        sourceTags: source.tags, tags,
        _keywords: extractKeywords(text), _cn: true,
      });
    }
    return items;
  } catch (e) { return []; }
}

async function fetchWeibo() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch('https://weibo.com/ajax/side/hotSearch', {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) KHTML/537.36 Chrome/120.0.0.0 Mobile Safari/537.36', 'Referer': 'https://weibo.com/' }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const topics = data?.data?.realtime || [];
    const items = [];
    for (const t of topics.slice(0, 50)) {
      if (!t.word) continue;
      const tags = tagNewsItem(t.word, t.note || '');
      items.push({
        _id: 'wb|' + t.word, title: t.word,
        link: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(t.word),
        snippet: (t.note || '').slice(0, 200), pubDate: new Date().toISOString(),
        source: '微博热搜', country: '中国', allCountries: ['中国'],
        sourceTags: ['热搜', '实时'], tags: tags.length ? tags : ['热议'],
        _keywords: extractKeywords(t.word + ' ' + (t.note || '')),
        _cn: true, _heatBase: Math.round((t.num || 100000) / 100000),
      });
    }
    return items;
  } catch (e) { return []; }
}

(async () => {
  console.log('Fetching news...');
  const parser = new RssParser({ timeout: 15000 });
  const allItems = [];

  // Fetch RSS + Weibo in parallel
  const results = await Promise.allSettled([
    fetchWeibo(),
    ...NEWS_SOURCES.map(s => fetchSource(s, parser)),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length) {
      allItems.push(...r.value);
      console.log(`  + ${r.value.length} items`);
    }
  }

  const clustered = clusterAndScore(allItems);
  const output = {
    updated: new Date().toISOString(),
    items: clustered,
    allTags: [...new Set(clustered.flatMap(i => i.tags))].sort(),
    allCountries: [...new Set(clustered.flatMap(i => i.allCountries || []))].sort(),
  };

  require('fs').writeFileSync('news.json', JSON.stringify(output));
  console.log(`Done: ${clustered.length} items written to news.json`);
})();
