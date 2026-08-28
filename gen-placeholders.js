/**
 * SVG Placeholder Generator for Generated POIs.
 * Creates attractive, category-colored SVG images so the app works immediately.
 * Later: download-gen-photos.js replaces them with real crawled photos.
 *
 * Usage: node gen-placeholders.js
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'routeplan', 'images', 'stores');

const CATEGORY_STYLES = {
  '日料':     { bg: '#FFF5EC', accent: '#E8734A', emoji: '🍣' },
  '火锅':     { bg: '#FFF0F0', accent: '#D4343E', emoji: '🍲' },
  '粤菜':     { bg: '#FFFDF5', accent: '#C8963E', emoji: '🥘' },
  '川菜':     { bg: '#FFF5F5', accent: '#CC3333', emoji: '🌶️' },
  '西餐':     { bg: '#FDF8F4', accent: '#8B5E3C', emoji: '🍷' },
  '韩餐':     { bg: '#FFF8F2', accent: '#E8613C', emoji: '🥩' },
  '东南亚菜': { bg: '#F5FDF8', accent: '#2D8B4E', emoji: '🍜' },
  '烧烤':     { bg: '#FFF9F2', accent: '#D4782F', emoji: '🍖' },
  '面食小吃': { bg: '#FFFDF8', accent: '#C8960A', emoji: '🥟' },
  '私房菜':   { bg: '#FDF5FC', accent: '#8B3A75', emoji: '🍽️' },
  '咖啡':     { bg: '#FDF9F5', accent: '#6F4E37', emoji: '☕' },
  '茶馆':     { bg: '#F7F5F0', accent: '#5B8C5A', emoji: '🍵' },
  '甜品':     { bg: '#FFF5FA', accent: '#E8879B', emoji: '🍰' },
  '酒吧':     { bg: '#1A1A2E', accent: '#E8A840', emoji: '🍸' },
  '公园':     { bg: '#F0F8F0', accent: '#3A7D44', emoji: '🌳' },
  '博物馆':   { bg: '#F5F5F8', accent: '#4A5568', emoji: '🏛️' },
  '历史建筑': { bg: '#F8F5F0', accent: '#8B7355', emoji: '🏯' },
  '商场':     { bg: '#F8F8FC', accent: '#3B5998', emoji: '🛍️' },
  '书店文创': { bg: '#FFFDF5', accent: '#8B6914', emoji: '📚' },
  '买手店':   { bg: '#FDF5FA', accent: '#7B3F8B', emoji: '👗' },
  '影院KTV':  { bg: '#1A1A2E', accent: '#E84855', emoji: '🎬' },
  '密室逃脱': { bg: '#111122', accent: '#FF6B35', emoji: '🔐' },
  '演出':     { bg: '#1B1B3A', accent: '#9B59B6', emoji: '🎵' },
  '文创空间': { bg: '#F5FDF8', accent: '#2E7D32', emoji: '🎨' },
};

function generateSVG(category, city, photoIndex) {
  const style = CATEGORY_STYLES[category] || { bg: '#F5F5F5', accent: '#888', emoji: '📍' };
  const label = `${city} · ${category}`;
  const isDark = style.bg.startsWith('#1') || style.bg.startsWith('#2');
  const textColor = isDark ? '#CCC' : '#666';
  const labelColor = isDark ? '#999' : '#999';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${style.bg}"/>
      <stop offset="100%" stop-color="${style.bg}" stop-opacity="0.8"/>
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <rect x="0" y="0" width="400" height="300" fill="none" stroke="${style.accent}" stroke-width="1" stroke-opacity="0.15" rx="4"/>
  <circle cx="200" cy="115" r="48" fill="${style.accent}" opacity="0.12"/>
  <text x="200" y="130" text-anchor="middle" font-size="56">${style.emoji}</text>
  <text x="200" y="180" text-anchor="middle" font-size="15" fill="${textColor}" font-family="-apple-system,sans-serif" font-weight="600">${label}</text>
  <text x="200" y="202" text-anchor="middle" font-size="11" fill="${labelColor}" font-family="-apple-system,sans-serif">photo #${photoIndex}</text>
  <circle cx="196" cy="250" r="3" fill="${style.accent}" opacity="0.3"/>
  <circle cx="200" cy="250" r="3" fill="${style.accent}" opacity="0.3"/>
  <circle cx="204" cy="250" r="3" fill="${style.accent}" opacity="0.3"/>
</svg>`;
}

function main() {
  console.log('=== Generating SVG Placeholders for Generated POIs ===\n');

  const cities = ['北京', '上海'];
  const categories = Object.keys(CATEGORY_STYLES);
  const POIS_PER_CAT = 13; // must match generateDiversePOIs count/templates
  const PHOTOS_PER_POI = 4;
  let totalPhotos = 0;

  for (const city of cities) {
    const photoBase = city === '北京' ? 401 : 801;

    for (const cat of categories) {
      for (let poiIdx = 0; poiIdx < POIS_PER_CAT; poiIdx++) {
        const photoId = photoBase + (categories.indexOf(cat) * POIS_PER_CAT) + poiIdx;

        for (let img = 1; img <= PHOTOS_PER_POI; img++) {
          const filename = `photo-${photoId}-${img}.svg`;
          const filepath = path.join(OUTPUT_DIR, filename);

          if (fs.existsSync(filepath)) continue;

          const svg = generateSVG(cat, city, img);
          fs.writeFileSync(filepath, svg, 'utf-8');
          totalPhotos++;
        }
      }
    }
  }

  const totalPOIs = cities.length * categories.length * POIS_PER_CAT;
  console.log(`Generated ${totalPhotos} SVG placeholders`);
  console.log(`For ${totalPOIs} POIs (${totalPOIs / 2} per city)`);
  console.log(`Categories: ${categories.length}`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main();
