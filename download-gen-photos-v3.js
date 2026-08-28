/**
 * Real Photo Downloader v3 — Baidu Image Search JSON API.
 *
 * Uses Baidu's acjson endpoint which returns structured JSON
 * (no HTML scraping needed). Best source for Chinese POI photos.
 *
 * Falls back to Picsum only when Baidu returns no results for a term.
 *
 * Usage: node download-gen-photos-v3.js [--skip-existing]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OUTPUT_DIR = path.join(__dirname, 'routeplan', 'images', 'stores');
const PHOTOS_PER_POI = 4;
const POIS_PER_CAT = 13; // 312 total / 24 categories

// Category → Baidu search keywords (Chinese, optimized)
const CATEGORY_QUERIES = {
  '日料':     ['日料店', '日本料理餐厅', '居酒屋'],
  '火锅':     ['火锅店', '火锅餐厅', '四川火锅店'],
  '粤菜':     ['粤菜餐厅', '茶餐厅', '广东菜馆'],
  '川菜':     ['川菜馆', '川菜餐厅', '四川菜馆'],
  '西餐':     ['西餐厅', '牛排馆', '法式餐厅'],
  '韩餐':     ['韩式烤肉店', '韩国料理', '韩餐馆'],
  '东南亚菜': ['泰式餐厅', '越南河粉', '东南亚餐厅'],
  '烧烤':     ['烧烤店', '烤肉店', '烤串店'],
  '面食小吃': ['面馆', '小吃店', '生煎店'],
  '私房菜':   ['私房菜', '私厨餐厅', '私房菜馆'],
  '咖啡':     ['咖啡店', '咖啡馆', '网红咖啡店'],
  '茶馆':     ['茶馆', '茶室', '中式茶馆'],
  '甜品':     ['甜品店', '蛋糕店', '网红甜品店'],
  '酒吧':     ['酒吧', '精酿酒吧', '鸡尾酒吧'],
  '公园':     ['城市公园', '公园景观', '湿地公园'],
  '博物馆':   ['博物馆', '美术馆', '展览馆'],
  '历史建筑': ['历史建筑', '名人故居', '古建筑'],
  '商场':     ['购物中心', '商场', '百货商场'],
  '书店文创': ['书店', '网红书店', '文创书店'],
  '买手店':   ['买手店', '设计师店铺', '时尚买手店'],
  '影院KTV':  ['电影院', 'KTV包间', '影城大厅'],
  '密室逃脱': ['密室逃脱', '沉浸式密室', '真人密室'],
  '演出':     ['livehouse', '演出场馆', '音乐现场'],
  '文创空间': ['文创园', '创意空间', '艺术园区'],
};

const SKIP_EXISTING = process.argv.includes('--skip-existing');

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', ...options.headers } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    if (SKIP_EXISTING && fs.existsSync(filepath)) return resolve('skip');
    const file = fs.createWriteStream(filepath);
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://image.baidu.com/' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); try { fs.unlinkSync(filepath); } catch (_) {}
        return downloadImage(res.headers.location, filepath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close(); try { fs.unlinkSync(filepath); } catch (_) {}
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve('ok'); });
      file.on('error', (e) => { try { fs.unlinkSync(filepath); } catch (_) {} reject(e); });
    }).on('error', (e) => { file.close(); try { fs.unlinkSync(filepath); } catch (_) {} reject(e); });
  });
}

// Extract image URLs from Baidu acjson response
function parseBaiduJson(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (!data.data) return [];
    return data.data
      .filter(item => item && item.thumbURL)
      .map(item => item.thumbURL.replace(/^http:/, 'https:'))
      .filter(url => url && url.length > 10);
  } catch (e) {
    return [];
  }
}

async function baiduImageSearch(query, count = 20) {
  const encoded = encodeURIComponent(query);
  const urls = [];
  // Baidu returns 30 per page, grab 2 pages for variety
  for (let pn = 0; pn < 60 && urls.length < count; pn += 30) {
    try {
      const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&logid=${Date.now()}&ipn=rj&ct=201326592&is=&fp=result&fr=&word=${encoded}&pn=${pn}&rn=30`;
      const body = await fetchUrl(url, { headers: { 'Referer': 'https://image.baidu.com/' } });
      const imgs = parseBaiduJson(body);
      for (const img of imgs) {
        if (!urls.includes(img)) urls.push(img);
        if (urls.length >= count) break;
      }
    } catch (e) {
      break;
    }
  }
  return urls;
}

async function downloadCategoryPhotos(category, city, photoBase) {
  const queries = CATEGORY_QUERIES[category] || [category];
  const needed = POIS_PER_CAT * PHOTOS_PER_POI;
  const cityQueries = queries.map(q => `${city}${q}`);

  // Collect URLs from all search queries
  let allUrls = [];
  for (const q of cityQueries) {
    if (allUrls.length >= needed + 10) break;
    try {
      const urls = await baiduImageSearch(q, Math.ceil(needed / cityQueries.length) + 5);
      console.log(`   🔍 "${q}": ${urls.length} images`);
      for (const u of urls) {
        if (!allUrls.includes(u)) allUrls.push(u);
      }
      await new Promise(r => setTimeout(r, 800)); // rate limit
    } catch (e) {
      console.log(`   ⚠️  "${q}": failed — ${e.message}`);
    }
  }

  console.log(`   Total unique URLs: ${allUrls.length} (need ${needed})`);

  // Download and assign
  let downloaded = 0;
  for (let poiIdx = 0; poiIdx < POIS_PER_CAT; poiIdx++) {
    const photoId = photoBase + poiIdx;
    for (let imgNum = 1; imgNum <= PHOTOS_PER_POI; imgNum++) {
      const filename = `photo-${photoId}-${imgNum}.jpg`;
      const filepath = path.join(OUTPUT_DIR, filename);
      const urlIdx = poiIdx * PHOTOS_PER_POI + (imgNum - 1);

      if (SKIP_EXISTING && fs.existsSync(filepath)) {
        downloaded++;
        continue;
      }

      if (urlIdx < allUrls.length) {
        try {
          await downloadImage(allUrls[urlIdx], filepath);
          downloaded++;
          await new Promise(r => setTimeout(r, 200));
        } catch (e) {
          console.log(`   ⚠️  ${filename}: download failed — ${e.message}`);
        }
      }
    }
  }

  return downloaded;
}

async function main() {
  console.log('=== Photo Downloader v3 — Baidu Image Search ===\n');
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Mode: ${SKIP_EXISTING ? 'skip existing' : 'download all'}\n`);

  const cities = ['北京', '上海'];
  const categories = Object.keys(CATEGORY_QUERIES);
  let totalDl = 0;

  for (const city of cities) {
    const photoBase = city === '北京' ? 401 : 601;
    let catIdx = 0;
    for (const cat of categories) {
      const base = photoBase + catIdx * POIS_PER_CAT;
      console.log(`\n📸 [${city}] ${cat} → photo-${base}~${base + POIS_PER_CAT - 1}`);
      const dl = await downloadCategoryPhotos(cat, city, base);
      console.log(`   ✅ ${dl}/${POIS_PER_CAT * PHOTOS_PER_POI} downloaded`);
      totalDl += dl;
      catIdx++;
      await new Promise(r => setTimeout(r, 1000)); // pause between categories
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Total JPGs: ${totalDl}`);
  console.log(`SVGs remain as fallback for any missing photos`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
