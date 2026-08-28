/**
 * Photo Downloader v4 — Checklist-based, one POI at a time.
 *
 * Searches Baidu images using the ACTUAL POI name + city as the query,
 * matching the photo-checklist.md entries exactly.
 *
 * Usage: node download-photos-v4.js [startId] [endId]
 *   node download-photos-v4.js            (all photos)
 *   node download-photos-v4.js 151 160    (range)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.join(__dirname, 'routeplan', 'images', 'stores');

// ── POI name list extracted from photo-checklist.md ────────────
// photo-001 → 故宫博物院, photo-002 → 八达岭长城, etc.
const POI_NAMES = [
  // === 北京 (photo-001 ~ photo-200) ===
  '故宫博物院','八达岭长城','天坛公园','颐和园','圆明园遗址公园','北海公园','景山公园','雍和宫','恭王府','明十三陵',
  '国家体育场鸟巢','国家游泳中心水立方','中央电视台总部大楼','中国尊','北京大兴国际机场','国家大剧院','北京环球度假区','北京欢乐谷','三里屯太古里','王府井大街',
  '中国国家博物馆','首都博物馆','中国美术馆','北京自然博物馆','中国科技馆','中国人民革命军事博物馆','北京天文馆','国家图书馆','北京鲁迅博物馆','老舍茶馆',
  '香山公园','奥林匹克森林公园','北京植物园','玉渊潭公园','朝阳公园','慕田峪长城','十渡风景区','龙庆峡','北京动物园','北京海洋馆',
  '南锣鼓巷','什刹海','烟袋斜街','五道营胡同','国子监街','前门大街','大栅栏','琉璃厂文化街','钟鼓楼','北京坊',
  '全聚德前门店','便宜坊崇文门店','四季民福烤鸭店','护国寺小吃总店','庆丰包子铺西单店','海底捞火锅王府井店','东来顺饭庄王府井店','花家怡园四合院店','姚记炒肝店鼓楼店','聚宝源牛街总店',
  '北京798艺术区','红砖美术馆','北京SKP','朝阳大悦城','北京apm','五棵松华熙LIVE','国贸商城','SKPS','西单大悦城','侨福芳草地',
  '三里屯酒吧街','后海酒吧街','工体','北京亮','望京SOHO','银河SOHO','侨福芳草地画廊','北京民生现代美术馆','今日美术馆','木木美术馆',
  '北京图书大厦','三联韬奋书店','PageOne书店北京坊店','钟书阁融科店','言几又王府中环店','元古本店','梵几客厅','失物招领','铃木食堂','熊也牛店',
  '食宝街','簋街','牛街','护国寺街','鲜鱼口美食街','北京坊餐饮','西单商圈餐饮','国贸餐饮','望京餐饮','三里屯餐饮',
  '颐和安缦','北京宝格丽酒店下午茶','璞瑄酒店','三里屯洲际酒店','怡亨酒店','王府半岛酒店','华尔道夫酒店','瑜舍酒店下午茶','国贸大酒店','新国贸饭店',
  '北京大学','清华大学','中央美术学院','中国传媒大学','北京电影学院','中关村创业大街','望京科技园','中关村软件园','上地信息产业基地','中关村壹号',
  // ... continues (full list in actual checklist)
];

// For complete coverage, build the full list from the checklist file
function loadPOINamesFromChecklist() {
  try {
    const content = fs.readFileSync(path.join(__dirname, 'routeplan', 'mock-data', 'photo-checklist.md'), 'utf-8');
    const lines = content.split('\n');
    const names = [];
    for (const line of lines) {
      // Pattern: | photo-NNN | POI名称 | ... |
      const match = line.match(/^\|\s*photo-(\d+)\s*\|\s*(.+?)\s*\|/);
      if (match) {
        names.push({ id: parseInt(match[1]), name: match[2].trim() });
      }
    }
    return names;
  } catch (e) {
    console.error('Failed to load checklist:', e.message);
    return [];
  }
}

// ── Baidu search for a specific POI ────────────────────────────
function baiduSearchPOI(poiName, city, count = 5) {
  return new Promise((resolve) => {
    const query = encodeURIComponent(city + ' ' + poiName);
    const referer = `https://image.baidu.com/search/index?tn=baiduimage&word=${query}`;
    const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&ct=201326592&is=&fp=result&word=${query}&pn=0&rn=${count}`;
    const imgUrls = [];

    https.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': referer,
        'Accept': 'text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.data) {
            for (const item of j.data) {
              if (item && item.thumbURL) {
                imgUrls.push(item.thumbURL.replace(/^http:/, 'https:'));
              }
            }
          }
        } catch (_) {}
        resolve(imgUrls);
      });
    }).on('error', () => resolve([]));
  });
}

function downloadImage(url, filepath) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://image.baidu.com/',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); try { fs.unlinkSync(filepath); } catch (_) {}
        return downloadImage(res.headers.location, filepath).then(resolve);
      }
      if (res.statusCode !== 200) {
        file.close(); try { fs.unlinkSync(filepath); } catch (_) {}
        return resolve('fail');
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve('ok'); });
      file.on('error', () => { try { fs.unlinkSync(filepath); } catch (_) {} resolve('fail'); });
    }).on('error', () => { file.close(); try { fs.unlinkSync(filepath); } catch (_) {} resolve('fail'); });
  });
}

async function main() {
  const startId = parseInt(process.argv[2]) || 1;
  const endId = parseInt(process.argv[3]) || 999;
  const pois = loadPOINamesFromChecklist();

  console.log(`=== Photo Downloader v4 — Checklist-based ===\n`);
  console.log(`Loaded ${pois.length} POIs from checklist`);
  console.log(`Range: photo-${String(startId).padStart(3,'0')} ~ photo-${String(endId).padStart(3,'0')}\n`);

  let downloaded = 0, skipped = 0, failed = 0;

  for (const poi of pois) {
    if (poi.id < startId || poi.id > endId) continue;

    const photoId = String(poi.id).padStart(3, '0');
    // City mapping per checklist: 001-200 北京, 201-400 上海, 401-405 北京, 406-410 上海
    const city = (poi.id <= 200 || (poi.id >= 401 && poi.id <= 405)) ? '北京' : '上海';

    // Check existing
    const existing = fs.existsSync(path.join(OUTPUT_DIR, `photo-${photoId}-1.jpg`));
    if (existing) { skipped++; continue; }

    console.log(`📸 photo-${photoId}: ${city} · ${poi.name}`);
    const urls = await baiduSearchPOI(poi.name, city, 8);

    if (urls.length === 0) {
      console.log(`   ❌ No results from Baidu`);
      failed++;
      continue;
    }

    // Download up to 4 photos per POI
    let dl = 0;
    for (let i = 0; i < Math.min(4, urls.length); i++) {
      const fp = path.join(OUTPUT_DIR, `photo-${photoId}-${i + 1}.jpg`);
      const r = await downloadImage(urls[i], fp);
      if (r === 'ok') dl++;
    }
    console.log(`   ✅ ${dl}/4 downloaded (${urls.length} found)`);
    downloaded += dl;

    // Rate limit
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n=== Done ===`);
  console.log(`Downloaded: ${downloaded} | Skipped: ${skipped} | Failed: ${failed}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
