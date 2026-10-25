// Zone 셀 레시피 검증 — 공정 설계 도크가 왼쪽에서 고른 Zone(유연생산·적응가공·정밀검사)의 셀 구성을 편집할 때의 규칙:
// 셀 고정(추가·삭제·유형 불가) · 셀 종류별 로봇 제약(머신텐딩 6축 1대 · 비전 게이지 무로봇 · 설비 자리 기준 최대 대수) · 변경 내역 · 예상 병목·UPH ·
// 적용(zonedefs 셀 정의 · 로봇 대수 효과 cycleK) · 저장/복원(바뀐 셀만). 실행: npm test
import { EXTRA_ZONES, INSP_CELLS } from '../js/zonedefs.js';
import { RECIPE_ZONES, recipeOf, defaultRecipe, normalizeRecipe, diffRecipe, recipeMetrics, recipeEff, applyRecipe, recipePatch, recipeFromPatch } from '../js/zonerecipe.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

console.log('== 레시피 읽기 · 기본값');
for (const k of RECIPE_ZONES) {
  const r = recipeOf(k), n = k === 'insp' ? Object.keys(INSP_CELLS).length : Object.keys(EXTRA_ZONES.find((Z) => Z.key === k).cells).length;
  check(`${r.name}: 셀 ${n}개 · 기본값과 차이 없음`, r.cells.length === n && !diffRecipe(defaultRecipe(k), r).length && r.cells.every((c) => c.par || recipeEff(c) === c.cycle || (c.T && Math.abs(recipeEff(c) - c.cycle) < 1e-9) || (c.T && !Array.isArray(c.T))));
}
{ const r = recipeOf('flex'), e = (id, m) => recipeEff(r.cells.find((c) => c.id === id), m);   // 유연생산: 레시피 사이클은 로봇 1대 기준 (flexible-manufacturing ZONE_DESIGN 4장 실효 사이클)
  check('유연생산 실효 사이클 = 실제 작업 시간 (레거시 · 자동화 · 피지컬AI — C03 스폿 122 · 67 · 67 · C07 재작업 90 · 40 · 60초)', ['traditional', 'smart', 'dark'].every((m, i) => Math.abs(e('C03', m) - [122, 67, 67][i]) < 0.05 && Math.abs(e('C07', m) - [90, 40, 60][i]) < 0.05) && Math.abs(e('C01') - 22) < 0.05,
    `C01 ${e('C01').toFixed(1)} · C03 ${e('C03').toFixed(1)} · C10 ${e('C10').toFixed(1)} · 이론 UPH ${Math.round(recipeMetrics(r).uph)}`); }
{ const a = recipeOf('adapt'), e = (id, m) => recipeEff(a.cells.find((c) => c.id === id), m);
  check('적응가공 실효 사이클 = 운영 기준 시간 (소재 식별 10 · 5축·사선홀·정밀절삭 60 · 선삭·CMM 40초)', [['MATL', 10], ['HB_MILL', 60], ['HB_DEBR', 60], ['RC_MILL', 60], ['RC_TURN', 40], ['CMM', 40]].every(([id, v]) => Math.abs(e(id) - v) < 1e-9)); }
console.log('== 제약');
const f = recipeOf('flex'), set = (r, id, kv) => Object.assign(r.cells.find((c) => c.id === id).robot, kv);
set(f, 'C06', { count: 2 }); set(f, 'C05', { count: 3 }); set(f, 'C03', { count: 9 }); f.cells.find((c) => c.id === 'C04').cycle = 9999; f.cells.pop();
let n = normalizeRecipe(f);
const by = (r, id) => r.cells.find((c) => c.id === id);
check('비전 게이지 셀은 로봇 없음 · 헤밍은 1대 · 최대 4대 · 사이클 2~1200초', by(n.recipe, 'C06').robot.count === 0 && by(n.recipe, 'C05').robot.count === 1 && by(n.recipe, 'C03').robot.count === 4 && by(n.recipe, 'C04').cycle === 1200, `경고 ${n.warnings.length}건`);
check('셀은 빼지 못함 (고정)', n.recipe.cells.length === recipeOf('flex').cells.length && n.warnings.some((w) => w.includes('고정')));
const a = recipeOf('adapt'); set(a, 'HB_MILL', { kind: 'cobot', count: 3 });
n = normalizeRecipe(a);
check('머신텐딩(5축) 셀은 6축 1대 고정', by(n.recipe, 'HB_MILL').robot.kind === 'articulated' && by(n.recipe, 'HB_MILL').robot.count === 1);
console.log('== 변경 · 예상 지표');
const g = recipeOf('flex'); set(g, 'C03', { count: 4 });
const d = diffRecipe(recipeOf('flex'), normalizeRecipe(g).recipe), m0 = recipeMetrics(recipeOf('flex')), m1 = recipeMetrics(normalizeRecipe(g).recipe);
check('변경 내역 1건 · 병목 셀 로봇 증설 → 이론 UPH 증가', d.length === 1 && d[0].id === 'C03' && m1.uph > m0.uph * 1.2, `${Math.round(m0.uph)} → ${Math.round(m1.uph)} · 병목 ${m0.bottleneck.name} → ${m1.bottleneck.name}`);
const ra = recipeOf('adapt'), mixA = recipeMetrics(ra, 'smart', { hblock: 1, rcover: 0 });
check('혼류 비율 반영: 유압블록만이면 리어커버 셀 부하 0', by(ra, 'RC_MILL')._load === 0 && by(ra, 'RC_TURN')._load === 0 && mixA.bottleneck.product !== 'rcover', `병목 ${mixA.bottleneck.name}`);
console.log('== 적용 · 저장/복원');
applyRecipe(normalizeRecipe(g).recipe);
const C03 = EXTRA_ZONES.find((Z) => Z.key === 'flex').cells.C03;
check('적용: 셀 정의 로봇 4대 · cycleK = 기본 2대 대비 병렬 이득', C03.robot[1] === 4 && Math.abs(C03.cycleK - (1 + 0.7) / (1 + 0.7 * 3)) < 1e-9 && C03.baseCount === 2, `cycleK ${C03.cycleK.toFixed(3)}`);
check('적용 뒤 레시피 = 적용한 값', recipeOf('flex').cells.find((c) => c.id === 'C03').robot.count === 4);
const p = recipePatch(recipeOf('flex')), back = recipeFromPatch('flex', p);
check('저장(바뀐 셀만) → 복원', p.length === 1 && p[0].id === 'C03' && !diffRecipe(recipeOf('flex'), back).length);
applyRecipe(defaultRecipe('flex'));
check('기본 레시피로 되돌리면 cycleK = 1', C03.cycleK === 1 && C03.robot[1] === 2);

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
