/**
 * Photo Downloader v5 — Full checklist: 1034 POIs, each with unique photo.
 *
 * For each category × city, searches Baidu with targeted queries
 * and downloads 52 photos (13 POIs × 4 each).
 *
 * Photo ID ranges:
 *   0001-0410: Original 410 POIs (already exist, skipped)
 *   0501-0812: Beijing generated 312 POIs (24 cats × 13)
 *   0813-1124: Shanghai generated 312 POIs (24 cats × 13)
 *
 * Usage: node download-photos-v5.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.join(__dirname, 'routeplan', 'images', 'stores');

// Category groups with photo base IDs, matching gen-full-checklist.js
const CATEGORY_GROUPS = [
  // Beijing: 0501 ~ 0812
  { cat:'日料',     city:'北京', base:501,  queries:['日料店 环境','日本料理 餐厅','居酒屋 内部'] },
  { cat:'火锅',     city:'北京', base:514,  queries:['火锅店 环境','四川火锅 餐厅','重庆火锅 店'] },
  { cat:'粤菜',     city:'北京', base:527,  queries:['粤菜餐厅','茶餐厅 环境','广式酒楼'] },
  { cat:'川菜',     city:'北京', base:540,  queries:['川菜馆','四川菜馆','麻辣餐厅'] },
  { cat:'西餐',     city:'北京', base:553,  queries:['西餐厅 环境','牛排馆','法式餐厅'] },
  { cat:'韩餐',     city:'北京', base:566,  queries:['韩式烤肉','韩国料理','韩餐馆 环境'] },
  { cat:'东南亚菜', city:'北京', base:579,  queries:['泰式餐厅','越南菜馆','东南亚餐厅'] },
  { cat:'烧烤',     city:'北京', base:592,  queries:['烧烤店','烤肉店 环境','烤串店'] },
  { cat:'面食小吃', city:'北京', base:605,  queries:['面馆 环境','小吃店','生煎店'] },
  { cat:'私房菜',   city:'北京', base:618,  queries:['私房菜馆','私厨 环境','私房菜 装修'] },
  { cat:'咖啡',     city:'北京', base:631,  queries:['咖啡店 环境','咖啡馆 装修','网红咖啡店'] },
  { cat:'茶馆',     city:'北京', base:644,  queries:['茶馆 环境','茶室 装修','中式茶馆'] },
  { cat:'甜品',     city:'北京', base:657,  queries:['甜品店 装修','蛋糕店 环境','网红甜品店'] },
  { cat:'酒吧',     city:'北京', base:670,  queries:['酒吧 环境','精酿酒吧','鸡尾酒吧 装修'] },
  { cat:'公园',     city:'北京', base:683,  queries:['城市公园 景观','公园 风景','湿地公园'] },
  { cat:'博物馆',   city:'北京', base:696,  queries:['博物馆 展厅','美术馆 内部','展览馆 环境'] },
  { cat:'历史建筑', city:'北京', base:709,  queries:['历史建筑 景点','名人故居','中国古建筑'] },
  { cat:'商场',     city:'北京', base:722,  queries:['购物中心 内部','商场 环境','百货商场'] },
  { cat:'书店文创', city:'北京', base:735,  queries:['书店 环境','网红书店 装修','文创书店'] },
  { cat:'买手店',   city:'北京', base:748,  queries:['买手店 装修','设计师店铺','时尚买手店'] },
  { cat:'影院KTV',  city:'北京', base:761,  queries:['电影院 大厅','KTV包间 装修','影城 环境'] },
  { cat:'密室逃脱', city:'北京', base:774,  queries:['密室逃脱 场景','密室 环境','真人密室'] },
  { cat:'演出',     city:'北京', base:787,  queries:['livehouse 现场','演出场馆','音乐现场'] },
  { cat:'文创空间', city:'北京', base:800,  queries:['文创园 环境','创意空间 装修','艺术园区'] },
  // Shanghai: 0813 ~ 1124
  { cat:'日料',     city:'上海', base:813,  queries:['日料店 环境','日本料理 餐厅','居酒屋 内部'] },
  { cat:'火锅',     city:'上海', base:826,  queries:['火锅店 环境','四川火锅 餐厅','重庆火锅 店'] },
  { cat:'粤菜',     city:'上海', base:839,  queries:['粤菜餐厅','茶餐厅 环境','广式酒楼'] },
  { cat:'川菜',     city:'上海', base:852,  queries:['川菜馆','四川菜馆','麻辣餐厅'] },
  { cat:'西餐',     city:'上海', base:865,  queries:['西餐厅 环境','牛排馆','法式餐厅'] },
  { cat:'韩餐',     city:'上海', base:878,  queries:['韩式烤肉','韩国料理','韩餐馆 环境'] },
  { cat:'东南亚菜', city:'上海', base:891,  queries:['泰式餐厅','越南菜馆','东南亚餐厅'] },
  { cat:'烧烤',     city:'上海', base:904,  queries:['烧烤店','烤肉店 环境','烤串店'] },
  { cat:'面食小吃', city:'上海', base:917,  queries:['面馆 环境','小吃店','生煎店'] },
  { cat:'私房菜',   city:'上海', base:930,  queries:['私房菜馆','私厨 环境','私房菜 装修'] },
  { cat:'咖啡',     city:'上海', base:943,  queries:['咖啡店 环境','咖啡馆 装修','网红咖啡店'] },
  { cat:'茶馆',     city:'上海', base:956,  queries:['茶馆 环境','茶室 装修','中式茶馆'] },
  { cat:'甜品',     city:'上海', base:969,  queries:['甜品店 装修','蛋糕店 环境','网红甜品店'] },
  { cat:'酒吧',     city:'上海', base:982,  queries:['酒吧 环境','精酿酒吧','鸡尾酒吧 装修'] },
  { cat:'公园',     city:'上海', base:995,  queries:['城市公园 景观','公园 风景','湿地公园'] },
  { cat:'博物馆',   city:'上海', base:1008, queries:['博物馆 展厅','美术馆 内部','展览馆 环境'] },
  { cat:'历史建筑', city:'上海', base:1021, queries:['历史建筑 景点','名人故居','中国古建筑'] },
  { cat:'商场',     city:'上海', base:1034, queries:['购物中心 内部','商场 环境','百货商场'] },
  { cat:'书店文创', city:'上海', base:1047, queries:['书店 环境','网红书店 装修','文创书店'] },
  { cat:'买手店',   city:'上海', base:1060, queries:['买手店 装修','设计师店铺','时尚买手店'] },
  { cat:'影院KTV',  city:'上海', base:1073, queries:['电影院 大厅','KTV包间 装修','影城 环境'] },
  { cat:'密室逃脱', city:'上海', base:1086, queries:['密室逃脱 场景','密室 环境','真人密室'] },
  { cat:'演出',     city:'上海', base:1099, queries:['livehouse 现场','演出场馆','音乐现场'] },
  { cat:'文创空间', city:'上海', base:1112, queries:['文创园 环境','创意空间 装修','艺术园区'] },
];

const POIS_PER_CAT = 13;
const PHOTOS_PER_POI = 4;

function baiduSearch(query, count = 25) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const referer = `https://image.baidu.com/search/index?tn=baiduimage&word=${encoded}`;
    const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&ct=201326592&is=&fp=result&word=${encoded}&pn=0&rn=${count}`;
    const urls = [];

    https.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': referer, 'Accept-Language': 'zh-CN' },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { const j = JSON.parse(d); if (j.data) for (const item of j.data) { if (item && item.thumbURL) { const u = item.thumbURL.replace(/^http:/, 'https:'); if (!urls.includes(u)) urls.push(u); } } } catch (_) {}
        resolve(urls);
      });
    }).on('error', () => resolve([]));
  });
}

function downloadImage(url, filepath) {
  return new Promise((resolve) => {
    if (fs.existsSync(filepath)) return resolve('skip');
    const file = fs.createWriteStream(filepath);
    https.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://image.baidu.com/' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) { file.close(); try { fs.unlinkSync(filepath); } catch (_) {} return downloadImage(res.headers.location, filepath).then(resolve); }
      if (res.statusCode !== 200) { file.close(); try { fs.unlinkSync(filepath); } catch (_) {} return resolve('fail'); }
      res.pipe(file); file.on('finish', () => { file.close(); resolve('ok'); });
      file.on('error', () => { try { fs.unlinkSync(filepath); } catch (_) {} resolve('fail'); });
    }).on('error', () => { file.close(); try { fs.unlinkSync(filepath); } catch (_) {} resolve('fail'); });
  });
}

async function main() {
  console.log('=== Photo Downloader v5 — Full Checklist ===\n');
  console.log(`Categories: ${CATEGORY_GROUPS.length}`);
  console.log(`POIs per category: ${POIS_PER_CAT}`);
  console.log(`Photos per category: ${POIS_PER_CAT * PHOTOS_PER_POI}\n`);

  let totalDl = 0, totalSkip = 0;
  for (const g of CATEGORY_GROUPS) {
    const needed = POIS_PER_CAT * PHOTOS_PER_POI;
    const pid = String(g.base).padStart(4, '0');
    console.log(`📸 [${g.city}] ${g.cat} → photo-${pid}~photo-${String(g.base + POIS_PER_CAT - 1).padStart(4, '0')} (${needed} photos)`);

    // Collect image URLs from all queries
    let allUrls = [];
    for (const q of g.queries) {
      if (allUrls.length >= needed + 20) break;
      const fullQ = g.city + ' ' + q;
      const urls = await baiduSearch(fullQ, 30);
      console.log(`   🔍 "${fullQ}": ${urls.length} images`);
      for (const u of urls) { if (!allUrls.includes(u)) allUrls.push(u); }
      await new Promise(r => setTimeout(r, 600));
    }

    console.log(`   📋 Total unique: ${allUrls.length} (need ${needed})`);

    // Download and assign: 13 POIs × 4 photos each
    let catDl = 0;
    for (let p = 0; p < POIS_PER_CAT; p++) {
      for (let i = 0; i < PHOTOS_PER_POI; i++) {
        const pid = String(g.base + p).padStart(4, '0');
        const fp = path.join(OUTPUT_DIR, `photo-${pid}-${i + 1}.jpg`);
        const idx = p * PHOTOS_PER_POI + i;
        if (idx < allUrls.length) {
          const r = await downloadImage(allUrls[idx], fp);
          if (r === 'ok') catDl++;
          else if (r === 'skip') { catDl++; totalSkip++; }
        }
      }
    }
    console.log(`   ✅ ${catDl}/${needed} downloaded\n`);
    totalDl += catDl;
    await new Promise(r => setTimeout(r, 2000)); // pause between categories
  }

  console.log(`=== Done: ${totalDl} downloaded, ${totalSkip} skipped ===`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
