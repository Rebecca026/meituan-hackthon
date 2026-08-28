/**
 * Pexels Photo Downloader — Free, reliable, actually works.
 *
 * Pexels API is free (200 req/hour), no credit card needed.
 * Get your key at: https://www.pexels.com/api/
 *
 * Without a key, falls back to Lorem Picsum (still real photos, just not searchable).
 *
 * Usage:
 *   PEXELS_API_KEY=your_key node download-pexels-photos.js
 *   node download-pexels-photos.js  (no key = Picsum fallback)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUTPUT_DIR = path.join(__dirname, 'routeplan', 'images', 'stores');
const PEXELS_KEY = process.env.PEXELS_API_KEY || '';
const PHOTOS_PER_POI = 4;
const POIS_PER_CAT = 13;
const SKIP_EXISTING = true;

// English search terms that Pexels understands well
const CATEGORY_TERMS = {
  '日料': ['japanese restaurant', 'sushi bar', 'ramen shop'],
  '火锅': ['chinese restaurant', 'hot pot', 'asian food'],
  '粤菜': ['chinese food', 'dim sum', 'cantonese cuisine'],
  '川菜': ['chinese cuisine', 'spicy food', 'asian restaurant'],
  '西餐': ['fine dining restaurant', 'steakhouse', 'elegant dinner'],
  '韩餐': ['korean restaurant', 'korean bbq', 'korean food'],
  '东南亚菜': ['thai restaurant', 'vietnamese food', 'asian bistro'],
  '烧烤': ['bbq restaurant', 'grill food', 'barbecue'],
  '面食小吃': ['noodle soup', 'street food', 'dumplings'],
  '私房菜': ['private dining', 'chef table', 'intimate restaurant'],
  '咖啡': ['coffee shop interior', 'cafe', 'coffee bar design'],
  '茶馆': ['tea house', 'tea room', 'chinese tea'],
  '甜品': ['dessert shop', 'bakery', 'cake shop interior'],
  '酒吧': ['cocktail bar', 'speakeasy', 'lounge bar interior'],
  '公园': ['city park', 'garden', 'park landscape'],
  '博物馆': ['museum interior', 'art gallery', 'exhibition'],
  '历史建筑': ['historic building', 'architecture heritage', 'traditional building'],
  '商场': ['shopping mall', 'mall interior', 'shopping center'],
  '书店文创': ['bookstore', 'library interior', 'book shop design'],
  '买手店': ['boutique store', 'fashion shop interior', 'designer store'],
  '影院KTV': ['cinema interior', 'movie theater lobby', 'entertainment venue'],
  '密室逃脱': ['escape room', 'mystery room', 'game room design'],
  '演出': ['live music venue', 'concert stage', 'music hall'],
  '文创空间': ['creative workspace', 'art studio', 'co-working space interior'],
};

// ── Pexels API search ──────────────────────────────────────────
function pexelsSearch(query, count) {
  return new Promise((resolve, reject) => {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${Math.min(count, 80)}&orientation=landscape`;
    https.get(url, {
      timeout: 15000,
      headers: { 'Authorization': PEXELS_KEY },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.photos) {
            resolve(j.photos.map(p => p.src.medium || p.src.large));
          } else {
            reject(new Error(j.error || 'No photos'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ── Picsum fallback (no key needed, reliable) ──────────────────
function picsumUrl(seed, width, height) {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
}

// ── Download single image ──────────────────────────────────────
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    if (SKIP_EXISTING && fs.existsSync(filepath)) return resolve('skip');
    const file = fs.createWriteStream(filepath);
    const proto = url.startsWith('https') ? https : require('http');
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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

async function main() {
  console.log('=== Pexels Photo Downloader ===\n');
  console.log(`Pexels API Key: ${PEXELS_KEY ? '✅ ' + PEXELS_KEY.substring(0, 8) + '...' : '❌ not set → using Picsum fallback'}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  const cities = ['北京', '上海'];
  const categories = Object.keys(CATEGORY_TERMS);
  let totalDl = 0;

  for (const city of cities) {
    const photoBase = city === '北京' ? 401 : 801;
    let catIdx = 0;
    for (const cat of categories) {
      const base = photoBase + catIdx * POIS_PER_CAT;
      const terms = CATEGORY_TERMS[cat];
      const needed = POIS_PER_CAT * PHOTOS_PER_POI;
      let allUrls = [];

      // Try Pexels first
      if (PEXELS_KEY) {
        for (const term of terms) {
          if (allUrls.length >= needed + 10) break;
          try {
            const urls = await pexelsSearch(term, Math.ceil(needed / terms.length) + 5);
            console.log(`   🔍 Pexels "${term}": ${urls.length} photos`);
            for (const u of urls) { if (!allUrls.includes(u)) allUrls.push(u); }
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {
            console.log(`   ⚠️  Pexels "${term}": ${e.message}`);
          }
        }
      }

      // Picsum fallback for any missing
      if (allUrls.length < needed) {
        console.log(`   📋 Picsum fallback for ${needed - allUrls.length} remaining`);
        for (let i = allUrls.length; i < needed; i++) {
          allUrls.push(picsumUrl(`${city}-${cat}-${i}`, 400, 300));
        }
      }

      // Download
      let dl = 0;
      for (let p = 0; p < POIS_PER_CAT; p++) {
        for (let i = 0; i < PHOTOS_PER_POI; i++) {
          const fp = path.join(OUTPUT_DIR, `photo-${base + p}-${i + 1}.jpg`);
          const idx = p * PHOTOS_PER_POI + i;
          if (idx < allUrls.length) {
            try { const r = await downloadImage(allUrls[idx], fp); if (r === 'ok') dl++; else if (r === 'skip') dl++;
              await new Promise(r => setTimeout(r, 100));
            } catch (_) {}
          }
        }
      }
      console.log(`   ✅ ${dl}/${needed} photos ready for "${cat}"`);
      totalDl += dl;
      catIdx++;
    }
  }

  console.log(`\n=== Done: ${totalDl} total photos ===`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
