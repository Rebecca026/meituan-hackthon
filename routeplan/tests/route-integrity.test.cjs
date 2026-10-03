const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Babel = require(process.env.ROUTE_BABEL_PATH || '@babel/standalone');
const root = path.resolve(__dirname, '..');

function load() {
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, AbortController,
    fetch: async () => { throw new Error('offline'); },
    localStorage: { getItem() { return null; } },
    window: { location: { hostname: 'localhost' }, _currentCity: '上海', MOCK_TRANSPORT: [{ station: '团结湖站', mode: '地铁' }] },
    React: {
      createElement(type, props, ...children) { return { type, props: props || {}, children }; },
      useState(value) { return [value, () => {}]; }, useEffect() {}, useRef(value) { return { current: value }; },
    },
    Icon() {}, Chip() {}, Toast() {}, PrimaryBtn() {}, StatusPill() {},
  });
  for (const filename of ['api.js', 'need-completion.jsx', 'route-detail.jsx', 'route-compare.jsx', 'nl-flow.jsx']) {
    vm.runInContext(Babel.transform(fs.readFileSync(path.join(root, filename), 'utf8'), { presets: ['react'], filename }).code, context);
  }
  return context;
}
function elements(node, name, out = []) {
  if (Array.isArray(node)) node.forEach(n => elements(n, name, out));
  else if (node && typeof node === 'object') {
    if ((typeof node.type === 'function' ? node.type.name : node.type) === name) out.push(node);
    elements(node.children, name, out);
  }
  return out;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (node && typeof node === 'object') return text(node.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
const c = load();

test('duration units, decimal hours and rounding stay correct', () => {
  assert.equal(c.durationMinutes('3 小时'), 180);
  assert.equal(c.durationMinutes('4 小时 15 分钟'), 255);
  assert.equal(c.durationMinutes('1.5 小时'), 90);
  assert.equal(c.durationMinutes('45 分钟'), 45);
  assert.equal(c.durationMinutes('3-4 小时'), null);
  assert.equal(c.durationMinutes('暂无数据'), null);
  assert.equal(c.fmtDuration(59.6), '1 小时');
  assert.equal(c.fmtDuration(null), '暂无数据');
});

test('budget comparison handles excess, equal, free and unknown values', () => {
  assert.equal(c.budgetLimit('¥150 以内'), 150);
  assert.equal(c.budgetLimit('80-150元'), 150);
  assert.equal(c.budgetLimit('不设上限'), null);
  assert.equal(c.budgetLimit('200元以上'), null);
  assert.equal(c.budgetMatch(180, 150), '超出 ¥30（20%）');
  assert.equal(c.budgetMatch(250, 150), '超出 ¥100（67%）');
  assert.equal(c.budgetMatch(150, 150), '符合');
  assert.equal(c.budgetMatch(0, 0), '符合');
  assert.equal(c.budgetMatch(null, 150), '待确认');
});

test('walking time excludes driving and preserves zero', () => {
  const mapped = c.mapRoute({ totalTravelTime: 180, segments: [
    { travelMode: 'DRIVING', travelTimeFromPrevious: 20 },
    { travelMode: 'WALKING', travelTimeFromPrevious: 9 },
  ] });
  assert.equal(mapped.total_duration_minutes, 180);
  assert.equal(mapped.total_walking_minutes, 9);
  assert.equal(c.routeWalkingMinutes({ total_walking_minutes: 0 }), 0);
  assert.equal(c.routeWalkingMinutes({ total_distance: '7.2km', transport: '驾车' }), null);
  assert.equal(c.routeWalkingMinutes({ _raw: { segments: [{ travelTimeFromPrevious: 8 }] } }), null);
});

test('comparison uses total duration independently of walking; unknown stays unknown', () => {
  const page = c.RouteComparePage({ routes: [
    { total_time: '3 小时', total_walking_minutes: 9, pois: [] },
    { total_time: '4 小时 15 分钟', total_distance: '7.2km', pois: [] },
  ] });
  const rows = elements(page, 'CompareRow');
  assert.deepEqual(Array.from(rows.find(r => r.props.label === '总耗时').props.values), [180, 255]);
  assert.deepEqual(Array.from(rows.find(r => r.props.label === '步行').props.values), [9, null]);
  assert.deepEqual(Array.from(rows.find(r => r.props.label === '偏好匹配').props.values), [null, null]);
});

test('comparison preserves each duration range and does not crown a tied result', () => {
  const page = c.RouteComparePage({ routes: [{ total_time: '2-3 小时' }, { total_time: '4-5 小时' }] });
  const row = elements(page, 'CompareRow').find(r => r.props.label === '总耗时');
  assert.equal(row.props.format(null, 0), '2-3 小时');
  assert.equal(row.props.format(null, 1), '4-5 小时');
  assert.equal(text(c.CompareRow({ label: '预算', values: [150, 150], highlight: 'lowest' })).includes('更低'), false);
  assert.equal(text(c.CompareRow({ label: '预算', values: [null, 150], highlight: 'lowest' })).includes('更低'), false);
});

test('offline routes disclose demo data without invented personal preferences', async () => {
  const result = await c.planWithFallback('一个人放松，预算150元', '一个人放松', {}, '上海');
  assert.equal(result.routes[0]._isDemo, true);
  assert.equal(result.routes[0]._preferenceScore, undefined);
  assert.equal(result.routes[0]._preferenceMatchTags, undefined);
  assert.equal(result.routes[0].constraintMatch.open_time, '待确认');
  assert.ok(result.routes[0]._dataWarning.includes('尚未按你的需求规划'));
});

test('failed adjustment keeps existing route and reports failure', async () => {
  const original = { id: 'my-route', total_avg: 99, pois: [] };
  const result = await c.adjustWithFallback('session', '地铁优先', [original], '上海');
  assert.equal(result.routes[0].id, 'my-route');
  assert.equal(result.routes[0].total_avg, 99);
  assert.equal(result.routes[0]._adjustmentFailed, true);
  assert.equal(original._adjustmentFailed, undefined);
});

test('card validates budget and passes same data to detail without changing source', () => {
  const source = { id: 'route', total_avg: 180, constraintMatch: { budget: '符合' }, pois: [] };
  const page = c.RouteOptionsCard({ routes: [source], scene: '朋友聚会', answers: { budget: '¥150 以内' } });
  const option = elements(page, 'RouteOption')[0];
  assert.equal(option.props.route.constraintMatch.budget, '超出 ¥30（20%）');
  assert.equal(option.props.route._budgetLimit, 150);
  assert.equal(option.props.route.constraintMatch.queue, '待确认');
  assert.equal(source.constraintMatch.budget, '符合');
});

test('Shanghai demo detail never borrows Beijing transport or invented opening status', () => {
  const detail = c.buildDetailData(c.getDemoRoutes('上海')[0]);
  assert.equal(detail.stationCount, 3);
  assert.ok(detail.transport.every(t => !t.station && t.time === '暂无数据'));
  assert.equal(detail.places[0].current_status_short, '待确认');
  assert.equal(detail.places[0].distance, '距离待确认');
});

test('fallback map handles any station count and expansion button works', () => {
  for (const count of [0, 1, 2, 3, 5]) {
    let toggled = 0;
    const page = c.MockMapFallback({ places: Array.from({ length: count }, (_, i) => ({ id: i, short: '地点'+i })), onToggle() { toggled++; } });
    const button = elements(page, 'button').find(b => text(b).includes('展开地图'));
    button.props.onClick();
    assert.equal(toggled, 1);
    const markers = elements(page, 'g');
    assert.equal(markers.length, count);
    for (const marker of markers) {
      const circle = elements(marker, 'circle')[1];
      assert.ok(circle.props.cx >= 0 && circle.props.cx <= 398);
      assert.ok(circle.props.cy >= 0 && circle.props.cy <= 220);
    }
  }
  assert.ok(text(c.MockMapFallback({ places: [], expanded: true, onToggle() {} })).includes('收起地图'));
});
