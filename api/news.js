// Serverless API handler for Vercel
const RssParser = require('rss-parser');

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
  const words = text.toLowerCase().replace(/[^\w\s一-鿿]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
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
      const text = (item.title || '') + ' ' + (item.contentSnippet || '') + 
