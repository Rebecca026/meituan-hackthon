/**
 * Generate full photo-checklist including all 522 POIs/city.
 * Original 410 POIs keep their existing photo IDs.
 * New 312 generated POIs/city get sequential photo IDs starting from 501.
 *
 * Output: routeplan/mock-data/photo-checklist-full.md
 */

const fs = require('fs');
const path = require('path');

const CATEGORIES = [
  { cat: '日料', city: '北京', baseId: 501 },
  { cat: '火锅', city: '北京', baseId: 514 },
  { cat: '粤菜', city: '北京', baseId: 527 },
  { cat: '川菜', city: '北京', baseId: 540 },
  { cat: '西餐', city: '北京', baseId: 553 },
  { cat: '韩餐', city: '北京', baseId: 566 },
  { cat: '东南亚菜', city: '北京', baseId: 579 },
  { cat: '烧烤', city: '北京', baseId: 592 },
  { cat: '面食小吃', city: '北京', baseId: 605 },
  { cat: '私房菜', city: '北京', baseId: 618 },
  { cat: '咖啡', city: '北京', baseId: 631 },
  { cat: '茶馆', city: '北京', baseId: 644 },
  { cat: '甜品', city: '北京', baseId: 657 },
  { cat: '酒吧', city: '北京', baseId: 670 },
  { cat: '公园', city: '北京', baseId: 683 },
  { cat: '博物馆', city: '北京', baseId: 696 },
  { cat: '历史建筑', city: '北京', baseId: 709 },
  { cat: '商场', city: '北京', baseId: 722 },
  { cat: '书店文创', city: '北京', baseId: 735 },
  { cat: '买手店', city: '北京', baseId: 748 },
  { cat: '影院KTV', city: '北京', baseId: 761 },
  { cat: '密室逃脱', city: '北京', baseId: 774 },
  { cat: '演出', city: '北京', baseId: 787 },
  { cat: '文创空间', city: '北京', baseId: 800 },
  // Shanghai: 813 ~ 1124
  { cat: '日料', city: '上海', baseId: 813 },
  { cat: '火锅', city: '上海', baseId: 826 },
  { cat: '粤菜', city: '上海', baseId: 839 },
  { cat: '川菜', city: '上海', baseId: 852 },
  { cat: '西餐', city: '上海', baseId: 865 },
  { cat: '韩餐', city: '上海', baseId: 878 },
  { cat: '东南亚菜', city: '上海', baseId: 891 },
  { cat: '烧烤', city: '上海', baseId: 904 },
  { cat: '面食小吃', city: '上海', baseId: 917 },
  { cat: '私房菜', city: '上海', baseId: 930 },
  { cat: '咖啡', city: '上海', baseId: 943 },
  { cat: '茶馆', city: '上海', baseId: 956 },
  { cat: '甜品', city: '上海', baseId: 969 },
  { cat: '酒吧', city: '上海', baseId: 982 },
  { cat: '公园', city: '上海', baseId: 995 },
  { cat: '博物馆', city: '上海', baseId: 1008 },
  { cat: '历史建筑', city: '上海', baseId: 1021 },
  { cat: '商场', city: '上海', baseId: 1034 },
  { cat: '书店文创', city: '上海', baseId: 1047 },
  { cat: '买手店', city: '上海', baseId: 1060 },
  { cat: '影院KTV', city: '上海', baseId: 1073 },
  { cat: '密室逃脱', city: '上海', baseId: 1086 },
  { cat: '演出', city: '上海', baseId: 1099 },
  { cat: '文创空间', city: '上海', baseId: 1112 },
];

const POIS_PER_CAT = 13;

function pad(n) { return String(n).padStart(4, '0'); }

let lines = [];
lines.push('# Mock POI 完整图片清单');
lines.push('');
lines.push('## 说明');
lines.push(`- 原有 410 POI: photo-0001 ~ photo-0410（保持不变）`);
lines.push(`- 新增 624 POI: photo-0501 ~ photo-1124（24品类 × 13 × 2城市）`);
lines.push(`- 总计 ${410 + 624} POI，每个 4 张照片`);
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 新增：程序化生成 POI（24品类 × 13个/品类 × 2城市）');
lines.push(`总共 ${CATEGORIES.length} 个品类分组，每个 13 个 POI，按品类搜索下载`);
lines.push('');

for (const group of CATEGORIES) {
  lines.push(`### ${group.city} · ${group.cat} (photo-${pad(group.baseId)} ~ photo-${pad(group.baseId + POIS_PER_CAT - 1)})`);
  lines.push('');
  lines.push('| 编号 | 搜索关键词 | 品类 |');
  lines.push('|------|-----------|------|');
  for (let i = 0; i < POIS_PER_CAT; i++) {
    const pid = pad(group.baseId + i);
    const kw = `${group.city} ${group.cat} ${i + 1}`;
    lines.push(`| photo-${pid} | ${kw} | ${group.cat} |`);
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## 下载方式');
lines.push('');
lines.push('每个品类用百度搜索「城市 + 品类名」获取 13 × 4 = 52 张照片。');
lines.push('```');
lines.push('node download-photos-v5.js');
lines.push('```');

const outPath = path.join(__dirname, 'routeplan', 'mock-data', 'photo-checklist-full.md');
fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`Generated: ${outPath}`);
console.log('New POIs: ' + CATEGORIES.length * POIS_PER_CAT + ' (' + CATEGORIES.length / 2 + ' groups/city)');
