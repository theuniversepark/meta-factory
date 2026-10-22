// Zone 셀 레시피 — 공정 설계 도크가 왼쪽에서 고른 Zone(유연생산 · 적응가공 · 정밀검사)의 셀 구성을 편집할 때 쓰는 모델 (브라우저·서버 공용, DOM 없음)
// 셀 배치·유형·흐름(routes)은 바닥에 고정 — 편집하는 것: 셀 이름 · 하는 일 · 기준 사이클 · 로봇 종류·대수 (셀 종류별 제약)
// 로봇 대수 효과: 기본 대수 대비 병렬 처리 이득(line.js PARALLEL_GAIN)만큼 사이클이 줄거나 늘어난다 — def.cycleK (기본 구성 = 1, 기존 시뮬레이션 그대로)
import { EXTRA_ZONES, INSP_CELLS } from './zonedefs.js';
import { PARALLEL_GAIN, ROBOT_KINDS, plainText } from './line.js';

export const RECIPE_ZONES = ['flex', 'adapt', 'insp'];
export const ZR_KINDS = { none: '로봇 없음', cobot: '협동로봇', articulated: '6축 산업용 로봇' };
const ALT_LABEL = { ammr: 'AMMR(양팔 모바일)', humanoid: '휴머노이드' };
const MODE_MUL = { traditional: 1.8, smart: 1, dark: 0.85 };
const gain = (n) => 1 + PARALLEL_GAIN * Math.max(0, n - 1);
const clone = (o) => JSON.parse(JSON.stringify(o));
const zoneOf = (key) => (key === 'insp' ? { key: 'insp', name: '정밀검사Zone', cells: INSP_CELLS, routes: { sample: Object.keys(INSP_CELLS) }, mixes: null } : EXTRA_ZONES.find((Z) => Z.key === key));

// 셀 종류별 제약: 머신텐딩(5축·선반)은 6축 1대 고정 · 비전 게이지 셀은 로봇 없음 고정 · 정밀검사는 6축 0~2대(O-INSPECT 1대)
function limits(key, c) {
  if (key === 'insp') return { kinds: ['articulated'], max: c.type === 'oins' ? 1 : c.type === 'dock' || c.type === 'judge' ? 0 : 2, min: 0, lockKind: true };
  if (c.type === 'mill5' || c.type === 'turn') return { kinds: ['articulated'], max: 1, min: 1, lockKind: true, why: '머신텐딩 — 6축 1대가 문 열림에 맞춰 넣고 뺀다' };
  if (c.type === 'vision') return { kinds: ['none'], max: 0, min: 0, lockKind: true, why: '비전·치수 게이지 셀 (로봇 없음)' };
  const max = MAX_BY_TYPE[c.type] ?? 2;
  return { kinds: ['cobot', 'articulated'], max, min: 1, lockKind: false, why: max < 4 ? `셀 설비 자리 기준 최대 ${max}대 (간섭 점검 — 그 이상은 로봇이 설비·옆 로봇과 겹침)` : null };
}
// 셀 종류별 최대 로봇 대수 — 로봇 자리(셀 네 귀퉁이)와 셀 설비가 겹치지 않는 대수 (tools/check-collisions.cjs COLLIDE_PRE로 최대 대수 점검)
const MAX_BY_TYPE = { kit: 2, locate: 2, spot: 4, seal: 3, hem: 1, mount: 4, rework: 1, matid: 4, deburr: 2, cmm: 2 };
// 처음 정의 (기본 레시피) — 모듈을 읽는 순간의 값
const DEFAULTS = Object.fromEntries(RECIPE_ZONES.map((k) => [k, recipeOf(k)]));
export const defaultRecipe = (key) => clone(DEFAULTS[key]);

export function recipeOf(key) {
  const Z = zoneOf(key); if (!Z) return null;
  const cells = Object.entries(Z.cells).map(([id, c]) => {
    const L = limits(key, c), R = key === 'insp' ? ['articulated', c.robots ?? 0] : c.robot ?? ['none', 0];
    return { id, no: c.no ?? id, type: c.type, name: c.label, task: c.use, product: c.product ?? 'shared', cycle: c.cycle, robot: { kind: key === 'insp' ? 'articulated' : R[0], count: R[1] }, alt: R[2] ? { kind: R[2], count: R[3], label: ALT_LABEL[R[2]] ?? R[2] } : null, base: c.baseCount ?? R[1], lim: L, par: !!Z.parallel };
  });
  return { zone: key, name: Z.name, cells, routes: Z.routes, mix: Z.mix ?? null };
}

// 값 정리: 범위 · 셀 종류 제약 — 바꾸지 못하는 값은 되돌리고 경고
export function normalizeRecipe(r) {
  const errors = [], warnings = [], cur = recipeOf(r?.zone);
  if (!cur) return { recipe: r, errors: ['알 수 없는 Zone'], warnings };
  const byId = Object.fromEntries((r.cells ?? []).map((c) => [c.id, c]));
  const cells = cur.cells.map((base) => {
    const c = byId[base.id]; if (!c) { warnings.push(`${base.name}: 셀은 바닥에 고정 — 빼지 않고 그대로 둡니다`); return base; }
    const L = base.lim, out = { ...base, name: plainText(c.name ?? base.name, 24) || base.name, task: plainText(c.task ?? base.task, 60) };
    const cy = Number(c.cycle); out.cycle = Number.isFinite(cy) ? Math.round(Math.min(300, Math.max(2, cy)) * 10) / 10 : base.cycle;
    if (Number.isFinite(cy) && cy !== out.cycle) warnings.push(`${out.name}: 기준 사이클 ${cy}초 → ${out.cycle}초 (2~300초)`);
    let kind = c.robot?.kind ?? base.robot.kind, count = Math.round(Number(c.robot?.count ?? base.robot.count));
    if (!L.kinds.includes(kind)) { if (kind !== base.robot.kind) warnings.push(`${out.name}: ${L.why ?? '로봇 종류 고정'} — ${ZR_KINDS[kind] ?? kind}는 쓸 수 없어 ${ZR_KINDS[base.robot.kind]}`); kind = base.robot.kind; }
    if (!Number.isFinite(count)) count = base.robot.count;
    const lo = L.min, hi = L.max; if (count < lo || count > hi) { warnings.push(`${out.name}: 로봇 ${count}대 → ${Math.min(hi, Math.max(lo, count))}대 (${lo}~${hi}대${L.why ? ` · ${L.why}` : ''})`); count = Math.min(hi, Math.max(lo, count)); }
    out.robot = { kind, count };
    return out;
  });
  return { recipe: { ...cur, cells }, errors, warnings };
}

export function diffRecipe(a, b) {
  const out = [], A = Object.fromEntries(a.cells.map((c) => [c.id, c]));
  for (const c of b.cells) {
    const p = A[c.id]; if (!p) continue;
    const parts = [];
    if (p.name !== c.name) parts.push(`이름 ${p.name} → ${c.name}`);
    if (p.cycle !== c.cycle) parts.push(`기준 사이클 ${p.cycle} → ${c.cycle}초`);
    if (p.robot.kind !== c.robot.kind || p.robot.count !== c.robot.count) parts.push(`로봇 ${ZR_KINDS[p.robot.kind]}×${p.robot.count} → ${ZR_KINDS[c.robot.kind]}×${c.robot.count}`);
    if (p.task !== c.task) parts.push('하는 일 변경');
    if (parts.length) out.push({ id: c.id, kind: 'mod', text: `${c.no} ${c.name}: ${parts.join(' · ')}` });
  }
  return out;
}

// 실효 사이클(셀 1개) · 셀 부하(혼류 비율 × 경로) · 병목 · 이론 UPH
export const recipeEff = (c, mode = 'smart') => {
  if (c.par) {   // 유연생산: 레시피 사이클은 로봇 1대 기준 — × 로봇 종류 배율 ÷ 대수 병렬 이득 (zones.js buildCrew와 같은 식)
    const R = mode === 'dark' && c.alt ? c.alt : c.robot, kf = mode === 'traditional' || !R.count ? 1 : ROBOT_KINDS[R.kind]?.factor ?? 1;
    return (c.cycle * (MODE_MUL[mode] ?? 1) * kf) / gain(R.count);
  }
  return c.cycle * (MODE_MUL[mode] ?? 1) * (c.robot.count && c.base ? gain(c.base) / gain(c.robot.count) : 1);
};
export function recipeMetrics(r, mode = 'smart', mixW = null) {
  const w = mixW ?? r.mix ?? Object.fromEntries(Object.keys(r.routes).map((p) => [p, 1])), tot = Object.values(w).reduce((a, x) => a + x, 0) || 1;
  const share = (id) => Object.entries(r.routes).reduce((a, [p, route]) => a + (route.includes(id) ? (w[p] ?? 0) / tot : 0), 0);   // 그 셀을 지나는 제품 비율 (정밀검사는 시료 경로 하나 = 1)
  let bn = null, worst = 0;
  for (const c of r.cells) { const load = recipeEff(c, mode) * share(c.id); c._load = load; if (load > worst) { worst = load; bn = c; } }
  return { cells: r.cells.length, robots: r.cells.reduce((a, c) => a + c.robot.count, 0), bottleneck: bn, uph: worst ? 3600 / worst : 0 };
}

// 적용: zonedefs의 셀 정의를 바꾼다 (zones.js · inspzone.js · sim.js 설비 관리가 같은 객체를 본다) — 화면은 그 Zone을 다시 구성
export function applyRecipe(r) {
  const Z = zoneOf(r.zone); if (!Z) return false;
  for (const c of r.cells) {
    const d = Z.cells[c.id]; if (!d) continue;
    d.baseCount ??= r.zone === 'insp' ? (d.robots ?? 0) : (d.robot?.[1] ?? 0);
    d.label = c.name; d.use = c.task; d.cycle = c.cycle;
    if (r.zone === 'insp') d.robots = c.robot.count;
    else { const alt = d.robot?.slice(2) ?? []; d.robot = [c.robot.count ? c.robot.kind : 'none', c.robot.count, ...alt]; }
    d.cycleK = c.robot.count && d.baseCount ? gain(d.baseCount) / gain(c.robot.count) : 1;   // 로봇 대수 효과 (기본 대수 = 1)
  }
  return true;
}
// 저장용 (바뀐 셀만)
export function recipePatch(r) {
  const D = Object.fromEntries(DEFAULTS[r.zone].cells.map((c) => [c.id, c]));
  return r.cells.filter((c) => { const d = D[c.id]; return d && (d.name !== c.name || d.task !== c.task || d.cycle !== c.cycle || d.robot.kind !== c.robot.kind || d.robot.count !== c.robot.count); }).map(({ id, name, task, cycle, robot }) => ({ id, name, task, cycle, robot }));
}
export function recipeFromPatch(key, patch) { const r = defaultRecipe(key); const P = Object.fromEntries((patch ?? []).map((c) => [c.id, c])); r.cells = r.cells.map((c) => (P[c.id] ? { ...c, ...P[c.id], robot: { ...P[c.id].robot } } : c)); return normalizeRecipe(r).recipe; }
