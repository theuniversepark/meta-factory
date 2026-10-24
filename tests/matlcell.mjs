// 적응가공 ① 소재 식별·3D측정셀 검증 (js/matlcell.js) — 셀 구성(남쪽 로봇 1대 + 이송 6축 + 스캔 로봇), 공정 순서(합격 · 불합격 → 예비 소재 교체)와 문 구간,
// 피지컬AI ①~⑥이 단계별로 다르게 기록되는지(파지 · 능동 스캔 뷰 수 · 결함 판정 · 가공 여유 → 가공셀 사이클·공구 마모 · OCR·LIBS · 프로브 힘), 센서값 · 데이터(MQTT 토픽) · 품질 표본 값을 확인한다
// (셀 애니메이션·간섭은 tools/check-sweeps.cjs). 실행: npm test
import { Simulation } from '../js/sim.js';
import { MATL_SPEC, MATL_SENSORS, MATL_TOPIC, MATL_PLANS, matlPlan, matlPhase } from '../js/matlcell.js';
import { cmmDoorK } from '../js/cmmcell.js';
import { EXTRA_ZONES, zoneCellAux } from '../js/zonedefs.js';
import { normalizeRecipe, defaultRecipe } from '../js/zonerecipe.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const run = (M, n, product = 'hblock', from = 0) => Array.from({ length: n }, (_, k) => { const it = { id: `ADP-${from + k}`, product }; it.mul = M.plan(it); M.done(it); return it; });
const avg = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;

console.log('== 구성');
const Z = EXTRA_ZONES.find((z) => z.key === 'adapt'), D = Z.cells.MATL;
check('소재 식별셀: 남쪽 협동로봇 1대(자동화) / 양팔 로봇 1대(피지컬AI) + 이송 6축 + 스캔 로봇 (레거시는 없음)', D.robot.join() === 'cobot,1,ammr,1' && D.aux?.[0] === 'articulated' && D.aux2?.[0] === 'cobot' && zoneCellAux(D, 'dark') === 2 && zoneCellAux(D, 'traditional') === 0);
const R = normalizeRecipe({ ...defaultRecipe('adapt'), cells: defaultRecipe('adapt').cells.map((c) => (c.id === 'MATL' ? { ...c, robot: { kind: 'cobot', count: 4 } } : c)) }), rc = R.recipe.cells.find((c) => c.id === 'MATL');
check('공정 설계: 소재 식별셀 로봇은 협동로봇 1대 고정', rc.robot.kind === 'cobot' && rc.robot.count === 1);
check('센서 6종 · 소재 2종 (합금 · 무게 · 가공 여유)', MATL_SENSORS.length === 6 && MATL_SPEC.mat.hblock.alloy === 'GCD450' && MATL_SPEC.mat.rcover.alloy === 'ADC12');

console.log('== 공정 순서 (진행률)');
for (const [k, P] of Object.entries(MATL_PLANS)) {
  const mono = P.seq.every((e, i) => !i || e[0] >= P.seq[i - 1][0]), ends = P.seq[0][1] === 'tuckA' && P.seq.at(-1)[0] === 1 && P.seq.at(-1)[2] === 'amr';
  const shut = P.scan.every(([a, b]) => [a + 0.003, (a + b) / 2, b - 0.003].every((p) => cmmDoorK(p, P.doors.scan) === 0));
  const inside = P.seq.filter((e) => e[1] === 'scan').every((e) => cmmDoorK(e[0], P.doors.scan) === 1);
  check(`${k}: 경로가 시간순 · tuckA에서 시작해 AMR 지그로 끝남 · 스캔 중 부스 문 닫힘 · 턴테이블 자리에서는 문 열림 · 프로브는 이송 6축이 집기 전`, mono && ends && shut && inside && P.probe[1] <= P.steps[0][1] && !P.doors.rack);
}
const J = MATL_PLANS.reject;
check('불합격: 1차 스캔 → 격리 랙에 내려놓고 예비 소재를 집어 → 다시 스캔', J.scan.length === 2 && J.seq.some((e) => e[2] === 'rack') && J.seq.filter((e) => e[1] === 'rack').length === 2);
check('단계 이름', matlPhase(MATL_PLANS.ok, 0.05) === 'probe' && matlPhase(MATL_PLANS.ok, 0.5) === 'scan' && matlPhase(MATL_PLANS.ok, 0.72) === 'fit' && matlPhase(J, 0.45) === 'swap' && matlPhase(J, 0.7) === 'rescan' && matlPhase(MATL_PLANS.ok, 0.3) === 'load');
check('계획이 없는 소재는 합격 경로', matlPlan({}) === MATL_PLANS.ok && matlPlan(null) === MATL_PLANS.ok);

console.log('== 피지컬AI · 자동화 · 레거시');
const sd = new Simulation('dark', 11, { quiet: true }), sm = new Simulation('smart', 11, { quiet: true }), sl = new Simulation('traditional', 11, { quiet: true });
const sent = []; sd.machmon.onItem = (x) => sent.push(x);
const dk = run(sd.matl, 400), at = run(sm.matl, 400), lg = run(sl.matl, 400);
const rej = (a) => a.filter((it) => it.matl.kind === 'reject').length, miss = (a) => a.filter((it) => it.matl.missed).length;
check('① 파지: 피지컬AI = VLA(후보 · 신뢰도) · 자동화 = 티칭 · 레거시 = 작업자', dk.every((it) => it.matl.grasp.method === 'VLA' && it.matl.grasp.candidates >= 6) && at.every((it) => it.matl.grasp.method === 'teach') && lg.every((it) => it.matl.grasp.method === 'manual'));
check('② 능동 스캔: 피지컬AI 5~9뷰 · 커버리지 99% 이상 / 자동화 고정 12뷰 · 레거시 스캔 없음', dk.every((it) => it.matl.views >= 5 && it.matl.views <= 9 && it.matl.coverage >= 99) && at.every((it) => it.matl.views === 12) && lg.every((it) => it.matl.views === 0),
  `평균 ${avg(dk, (x) => x.matl.views).toFixed(1)}뷰 vs 12뷰`);
// 불량 소재 비율이 낮아(1.7%) 많이 돌려 놓친 비율을 본다
const big = [['dark', 13], ['smart', 13], ['traditional', 13]].map(([m, seed]) => { const x = new Simulation(m, seed, { quiet: true }); return run(x.matl, 4000, 'hblock', 5000); });
const missRate = (a) => miss(a) / Math.max(1, miss(a) + rej(a));
check('③ 결함·불합격: 피지컬AI는 놓치지 않음 · 자동화는 작은 주조 결함 일부를 놓침 · 레거시는 더 놓침', miss(big[0]) === 0 && rej(big[0]) > 30 && missRate(big[1]) > 0.1 && missRate(big[2]) > missRate(big[1]),
  `놓친 비율 ${(missRate(big[0]) * 100).toFixed(0)}% / ${(missRate(big[1]) * 100).toFixed(0)}% / ${(missRate(big[2]) * 100).toFixed(0)}%`);
check('불합격이면 셀 시간 2배 (예비 소재로 교체 후 다시 스캔)', dk.every((it) => it.mul === (it.matl.kind === 'reject' ? 2 : 1)));
const okd = dk.filter((it) => it.matl.kind === 'ok');
check('④ 가공 여유 → 가공셀: 피지컬AI 합격품은 원점 보정 전달 (사이클 ×0.94 · 마모 ×0.9) · 자동화·레거시는 고정 여유', okd.every((it) => it.matl.offset && it.matl.cutMul === 0.94 && it.matl.wearMul === 0.9) && at.every((it) => !it.matl.offset && it.matl.cutMul === 1) && lg.every((it) => it.matl.cutMul === 1));
check('여유 부족 소재는 최소 여유가 기준보다 얇음', dk.filter((it) => it.matl.reason === 'allow').every((it) => it.matl.minAllow < MATL_SPEC.mat[it.product].min));
check('⑤ OCR·재질: 피지컬AI = AI OCR(0.95 이상) · AI LIBS / 자동화 = 규칙 OCR(낮으면 작업자 확인) / 레거시 = 작업자 · 재질 분석 없음', dk.every((it) => it.matl.ocr.method === 'AI OCR' && it.matl.ocr.conf >= 0.95 && it.matl.libs.method.startsWith('AI')) && at.some((it) => it.matl.ocr.manual) && lg.every((it) => it.matl.ocr.manual && !it.matl.libs));
check('재질 혼입이면 LIBS가 다른 합금을 읽음', dk.filter((it) => it.matl.reason === 'alloy').every((it) => it.matl.libs.alloy !== MATL_SPEC.mat[it.product].alloy));
check('⑥ 접촉 측정: 피지컬AI 힘 제어(약 8~15N)가 자동화(약 18~35N)보다 낮음', avg(dk, (x) => x.matl.force) < avg(at, (x) => x.matl.force) - 6, `${avg(dk, (x) => x.matl.force).toFixed(1)}N vs ${avg(at, (x) => x.matl.force).toFixed(1)}N`);
check('기록 · 품질 표본 값(최소 가공 여유) · MQTT (…/part) · 격리 목록', sd.matl.records.length === 60 && dk.every((it) => it.qx?.matl?.minAllow > 0) && sent.filter((x) => x.topic === `${MATL_TOPIC}/part`).length === 400 && sd.matl.quarantine.length > 0);
check('레거시: 데이터 전송 없음', !sl.matl.on);

console.log('== ④ 가공셀 공구 마모 (적응가공 오케스트레이터)');
const O = sd.fos.adapt, cellM = { id: 'HB_MILL', def: { type: 'mill5' } }, w0 = (() => { const t = O.tool(cellM); t.wear = 0; return t; })();
let r1 = 0; O.afterCell(cellM, { id: 'x', matl: { wearMul: 1 } }, () => 0.5); r1 = O.tool(cellM).wear; O.tool(cellM).wear = 0;
O.afterCell(cellM, { id: 'y', matl: { wearMul: 0.9 } }, () => 0.5); const r2 = O.tool(cellM).wear;
check('원점 보정 전달 소재는 5축 가공 공구 마모가 10% 적음', Math.abs(r2 / r1 - 0.9) < 1e-9, `${r1.toExponential(3)} → ${r2.toExponential(3)}`);

console.log('== 스캔 부스 센서값');
const it = { id: 'ADP-X', product: 'hblock' }; sd.matl.plan(it);
const cell = { id: 'MATL', state: 'BUSY', progress: 0.5, fault: null, halt: false, item: it };
sd.xzones = { byKey: (k) => (k === 'adapt' ? { cells: { MATL: cell } } : null) };
sd.matl.acc = 1; sd.matl.tick(0); const sc = { ...sd.matl.latest };
cell.progress = 0.06; sd.matl.acc = 1; sd.matl.tick(0); const pr = { ...sd.matl.latest };
cell.progress = 0.3; sd.matl.acc = 1; sd.matl.tick(0); const dr = { ...sd.matl.latest };
check('스캔 중: 부스 어두움 · 무게 · 커버리지', sc.phase === 'scan' && sc.lux < 20 && Math.abs(sc.weight - MATL_SPEC.mat.hblock.kg) < 2 && sc.cover >= 99, JSON.stringify(sc));
check('프로브 접촉 중 힘 기록 · 문 열린 동안 조도는 높지만 경보 아님', pr.phase === 'probe' && pr.force > 0 && dr.lux > 60 && sd.matl.levels.lux === 'ok');

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
