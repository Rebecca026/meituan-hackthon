/**
 * Baidu Image Downloader — Working Version.
 * Uses Baidu's public acjson endpoint with proper Referer headers.
 * Downloads real Chinese store/restaurant photos from Baidu image search.
 *
 * Usage: node download-baidu-photos.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.join(__dirname, 'routeplan', 'images', 'stores');

// Category → Baidu Chinese search keywords
const CATEGORY_QUERIES = {
  '日料':     ['日料店 环境', '日本料理餐厅', '居酒屋装修'],
  '火锅':     ['火锅店环境', '四川火锅店', '重庆火锅'],
  '粤菜':     ['粤菜餐厅环境', '茶餐厅装修', '广式酒楼'],
  '川菜':     ['川菜馆环境', '四川菜馆', '麻辣餐厅'],
  '西餐':     ['西餐厅环境', '牛排馆装修', '法式餐厅'],
  '韩餐':     ['韩式烤肉店', '韩国料理餐厅', '韩餐馆环境'],
  '东南亚菜': ['泰式餐厅装修', '越南菜馆', '东南亚餐厅环境'],
  '烧烤':     ['烧烤店环境', '烤肉店装修', '烤串店'],
  '面食小吃': ['面馆装修', '小吃店环境', '生煎店'],
  '私房菜':   ['私房菜馆', '私厨环境', '私房菜装修'],
  '咖啡':     ['咖啡店环境', '咖啡馆装修', '网红咖啡店'],
  '茶馆':     ['茶馆装修', '茶室环境', '中式茶馆'],
  '甜品':     ['甜品店装修', '蛋糕店环境', '网红甜品店'],
  '酒吧':     ['酒吧环境', '精酿酒吧装修', '鸡尾酒吧'],
  '公园':     ['城市公园景观', '公园风景', '湿地公园'],
  '博物馆':   ['博物馆展厅', '美术馆内部', '展览馆环境'],
  '历史建筑': ['历史建筑景点', '名人故居', '中国古建筑'],
  '商场':     ['购物中心内部', '商场环境', '百货商场装修'],
  '书店文创': ['书店环境', '网红书店装修', '文创书店'],
  '买手店':   ['买手店装修', '设计师店铺', '时尚买手店环境'],
  '影院KTV':  ['电影院大厅', 'KTV包间装修', '影城环境'],
  '密室逃脱': ['密室逃脱场景', '密室环境', '真人密室装修'],
  '演出':     ['livehouse现场', '演出场馆环境', '音乐现场'],
  '文创空间': ['文创园环境', '创意空间装修', '艺术园区'],
};

// ── Baidu image search ──────────────────────────────────────────
function baiduSearch(query, count = 30) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const referer = `https://image.baidu.com/search/index?tn=baiduimage&word=${encoded}`;
    const allUrls = [];

    function fetchPage(pn) {
      if (pn >= 60 || allUrls.length >= count) {
        return resolve(allUrls.slice(0, count));
      }
      const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&ct=201326592&is=&fp=result&word=${encoded}&pn=${pn}&rn=30&cg=head`;
      https.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
                  const u = item.thumbURL.replace(/^http:/, 'https:');
                  if (!allUrls.includes(u)) allUrls.push(u);
                }
              }
            }
          } catch (_) {}
          setTimeout(() => fetchPage(pn + 30), 500);
        });
      }).on('error', () => {
        setTimeout(() => fetchPage(pn + 30), 500);
      });
    }
    fetchPage(0);
  });
}

// ── Download single image ──────────────────────────────────────
function downloadImage(url, filepath) {
  return new Promise((resolve) => {
    if (fs.existsSync(filepath)) return resolve('skip');
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
  console.log('=== Baidu Image Downloader ===\n');
  console.log('Source: Baidu image search (acjson API)');
  console.log(`Output: ${OUTPUT_DIR}\n`);

  const categories = Object.keys(CATEGORY_QUERIES);
  let totalDl = 0;

  for (const cat of categories) {
    const queries = CATEGORY_QUERIES[cat];
    const needed = 52; // 13 POIs × 4 photos

    // Collect URLs from all queries
    let allUrls = [];
    for (const q of queries) {
      if (allUrls.length >= needed + 10) break;
      const urls = await baiduSearch(q, 25);
      console.log(`  🔍 "${q}": ${urls.length} images`);
      for (const u of urls) { if (!allUrls.includes(u)) allUrls.push(u); }
      await new Promise(r => setTimeout(r, 800));
    }

    console.log(`  📸 ${cat}: ${allUrls.length} unique URLs`);

    // Download to a pool for this category
    // These JPGs go into a pool, then get assigned by the POI generator
    let dl = 0;
    for (let i = 0; i < Math.min(allUrls.length, needed * 2); i++) {
      const fp = path.join(OUTPUT_DIR, `baidu-${cat}-${i + 1}.jpg`);
      const r = await downloadImage(allUrls[i], fp);
      if (r === 'ok' || r === 'skip') dl++;
    }
    console.log(`  ✅ ${dl} downloaded\n`);
    totalDl += dl;
    await new Promise(r => setTimeout(r, 2000)); // pause between categories
  }

  console.log(`=== Done: ${totalDl} photos downloaded ===`);
  console.log(`Files are in: ${OUTPUT_DIR}`);
  console.log(`Named as: baidu-{category}-{N}.jpg`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
