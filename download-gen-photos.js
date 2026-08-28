/**
 * Generated POI Photo Downloader — crawls real store/venue photos for generated POIs.
 *
 * Strategy:
 *   For each of the 24 categories, search Bing Images with queries like
 *   "北京日料店 环境", "上海火锅店 门面", etc., and download unique images.
 *   Assigns 4 photos per generated POI, never reusing the same image.
 *
 * Also generates SVG placeholders as fallback when crawling fails.
 *
 * Usage: node download-gen-photos.js [--dry-run] [--force]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OUTPUT_DIR = path.join(__dirname, 'routeplan', 'images', 'stores');
const IMAGES_PER_POI = 4;
const DELAY_MS = 1500;

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// ── Category search keywords (Chinese, good for Bing) ──────────
const CATEGORY_KEYWORDS = {
  '日料': ['日料店 环境', '日本料理 餐厅', '居酒屋 装修', 'sushi restaurant interior', 'japanese restaurant china'],
  '火锅': ['火锅店 门面', '火锅餐厅 环境', 'hotpot restaurant interior', '火锅店 装修'],
  '粤菜': ['粤菜餐厅', '茶餐厅 环境', '广东菜 餐厅', 'cantonese restaurant interior'],
  '川菜': ['川菜馆', '四川菜 餐厅', '川菜店 装修', 'sichuan restaurant china'],
  '西餐': ['西餐厅 环境', '牛排馆 装修', '法餐 餐厅', 'western restaurant interior china'],
  '韩餐': ['韩式烤肉店', '韩国料理 餐厅', '炸鸡店 环境', 'korean bbq restaurant china'],
  '东南亚菜': ['泰餐厅 环境', '越南河粉店', '东南亚餐厅', 'thai restaurant interior china'],
  '烧烤': ['烧烤店 环境', '烤肉店 装修', '串吧 装修', 'bbq restaurant china'],
  '面食小吃': ['面馆 环境', '小笼包店', '生煎店 门面', '生煎', 'noodle shop china interior'],
  '私房菜': ['私房菜 环境', '私厨 装修', '四合院餐厅', 'private kitchen restaurant china'],
  '咖啡': ['咖啡店 环境', '网红咖啡', '咖啡馆 装修', 'coffee shop interior china', 'cafe interior beijing shanghai'],
  '茶馆': ['茶馆 环境', '茶室 装修', '中式茶馆', 'tea house interior china'],
  '甜品': ['甜品店 环境', '蛋糕店 装修', '网红甜品', 'dessert shop interior china'],
  '酒吧': ['酒吧 环境', '精酿酒吧', '鸡尾酒吧 装修', 'bar interior china', 'speakeasy bar shanghai'],
  '公园': ['城市公园', '公园 景观', '湿地公园', 'city park china scenery'],
  '博物馆': ['博物馆 展厅', '美术馆 内部', '展览馆', 'museum interior china', 'art gallery china'],
  '历史建筑': ['历史建筑', '名人故居', '古建筑 中国', 'historic building china'],
  '商场': ['购物中心 内部', '商场 环境', 'mall interior china', 'shopping center beijing shanghai'],
  '书店文创': ['书店 环境', '文创店', '网红书店', 'bookstore interior china', '钟书阁'],
  '买手店': ['买手店 装修', '设计师店', '时尚买手店', 'boutique store interior china'],
  '影院KTV': ['电影院 大厅', 'KTV包间', '影城 环境', 'cinema lobby china'],
  '密室逃脱': ['密室逃脱 场景', '沉浸式剧场', 'escape room interior china'],
  '演出': ['livehouse 现场', '演出场馆', '音乐现场', 'live music venue china'],
  '文创空间': ['文创园', '创意空间', '艺术区', 'creative space china'],
};

// ── Download a single image from URL ────────────────────────────
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filepath) && !FORCE) {
      console.log('  ⏭  skip (exists):', path.basename(filepath));
      return resolve('skipped');
    }
    if (DRY_RUN) {
      console.log('  📋 would download:', path.basename(filepath));
      return resolve('dry-run');
    }
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filepath);
    proto.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        // Follow redirect
        downloadImage(res.headers.location, filepath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filepath);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve('ok'); });
      file.on('error', (e) => { fs.unlinkSync(filepath); reject(e); });
    }).on('error', (e) => { file.close(); try { fs.unlinkSync(filepath); } catch(_){} reject(e); });
  });
}

// ── Bing image search (scrapes HTML, no API key needed) ─────────
function bingImageSearch(query, count) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(query);
    const url = `https://www.bing.com/images/search?q=${encoded}&first=1&count=${count}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        // Extract image URLs from Bing's murl or src attributes
        const matches = body.match(/murl&quot;:&quot;(https?:[^&]+\.(?:jpg|jpeg|png|webp)[^&"]*)/gi) || [];
        const urls = matches.map(m => m.replace(/murl&quot;:&quot;/, '').replace(/&quot;.*$/, '').replace(/\\u002f/g, '/'));
        const unique = [...new Set(urls)].slice(0, count);
        console.log(`  Bing search "${query}": found ${unique.length} images`);
        resolve(unique);
      });
    }).on('error', reject);
  });
}

// ── Generate SVG placeholder as fallback ─────────────────────────
function generatePlaceholderSVG(category, city, cIndex) {
  const colors = {
    '日料': '#F5E6D3', '火锅': '#FFE0E0', '粤菜': '#FFF8E1', '川菜': '#FFECEC',
    '西餐': '#E8E0D8', '韩餐': '#FFE8D6', '东南亚菜': '#E8F5E9', '烧烤': '#FFEBD6',
    '面食小吃': '#FFF5E0', '私房菜': '#F3E5F5', '咖啡': '#EFEBE9', '茶馆': '#E8E6D9',
    '甜品': '#FCE4EC', '酒吧': '#263238', '公园': '#E8F5E9', '博物馆': '#ECEFF1',
    '历史建筑': '#EFEBE9', '商场': '#F5F5F5', '书店文创': '#FFF8E1', '买手店': '#F3E5F5',
    '影院KTV': '#263238', '密室逃脱': '#1A1A1A', '演出': '#311B92', '文创空间': '#E0F2F1',
  };
  const emoji = {
    '日料':'🍣','火锅':'🍲','粤菜':'🥘','川菜':'🌶️','西餐':'🍷','韩餐':'🥩',
    '东南亚菜':'🍜','烧烤':'🍖','面食小吃':'🥟','私房菜':'🍽️','咖啡':'☕','茶馆':'🍵',
    '甜品':'🍰','酒吧':'🍸','公园':'🌳','博物馆':'🏛️','历史建筑':'🏯','商场':'🛍️',
    '书店文创':'📚','买手店':'👗','影院KTV':'🎬','密室逃脱':'🔐','演出':'🎵','文创空间':'🎨',
  };
  const bg = colors[category] || '#F0F0F0';
  const em = emoji[category] || '📍';
  const label = `${city} · ${category}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="${bg}"/>
  <text x="200" y="130" text-anchor="middle" font-size="72">${em}</text>
  <text x="200" y="185" text-anchor="middle" font-size="16" fill="#666" font-family="sans-serif">${label}</text>
  <text x="200" y="210" text-anchor="middle" font-size="12" fill="#999" font-family="sans-serif">photo ${cIndex + 1}/4</text>
</svg>`;
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('=== Generated POI Photo Downloader ===\n');

  // Build list of all (category, city) pairs that need photos
  const cities = ['北京', '上海'];
  const categories = Object.keys(CATEGORY_KEYWORDS);
  let totalPOIs = 0;
  let downloaded = 0;
  let placeholders = 0;
  let skipped = 0;

  for (const city of cities) {
    for (const cat of categories) {
      const keywords = CATEGORY_KEYWORDS[cat];
      if (!keywords) continue;

      // 8 POIs per category per city, 4 photos each = 32 photos needed
      const poiCount = 8;
      const photosNeeded = poiCount * IMAGES_PER_POI;
      totalPOIs += poiCount;

      console.log(`\n📸 ${city} · ${cat} (${poiCount} POIs, ${photosNeeded} photos needed)`);
      console.log(`   Search keywords: ${keywords.slice(0, 2).join(' | ')}`);

      // Crawl images from Bing for this category + city
      let allUrls = [];
      for (const kw of keywords) {
        if (allUrls.length >= photosNeeded + 10) break;
        try {
          const query = `${city}${kw}`;
          const urls = await bingImageSearch(query, Math.ceil(photosNeeded / keywords.length) + 5);
          allUrls = [...allUrls, ...urls];
          await new Promise(r => setTimeout(r, DELAY_MS));
        } catch (e) {
          console.log(`   ⚠️  Bing search failed for "${kw}": ${e.message}`);
        }
      }

      allUrls = [...new Set(allUrls)].slice(0, photosNeeded);

      if (allUrls.length < photosNeeded) {
        console.log(`   ⚠️  Only found ${allUrls.length}/${photosNeeded} images — will use SVG placeholders for the rest`);
      }

      // Download and assign photos to POIs
      for (let p = 0; p < poiCount; p++) {
        const poiPhotoBase = 401 + totalPOIs - poiCount + p; // start from photo-401+
        for (let img = 0; img < IMAGES_PER_POI; img++) {
          const imgIdx = p * IMAGES_PER_POI + img;
          const filename = `photo-${poiPhotoBase}-${img + 1}.jpg`;
          const filepath = path.join(OUTPUT_DIR, filename);
          const svgPath = filepath.replace('.jpg', '.svg');

          if (allUrls[imgIdx]) {
            try {
              const result = await downloadImage(allUrls[imgIdx], filepath);
              if (result === 'ok') downloaded++;
              else if (result === 'skipped') skipped++;
              await new Promise(r => setTimeout(r, 300));
            } catch (e) {
              // Fallback: save SVG placeholder
              const svg = generatePlaceholderSVG(cat, city, img);
              fs.writeFileSync(svgPath, svg);
              placeholders++;
              console.log(`   📝 SVG placeholder: ${filename.replace('.jpg', '.svg')}`);
            }
          } else {
            // No URL available — generate SVG placeholder
            if (!fs.existsSync(svgPath) || FORCE) {
              const svg = generatePlaceholderSVG(cat, city, img);
              fs.writeFileSync(svgPath, svg);
              placeholders++;
            }
          }
        }
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Total POIs: ${totalPOIs}`);
  console.log(`Photos downloaded: ${downloaded}`);
  console.log(`SVG placeholders: ${placeholders}`);
  console.log(`Skipped (existing): ${skipped}`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
