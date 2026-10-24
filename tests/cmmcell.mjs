// 적응가공 ⑥ 초정밀 측정·리워크셀 검증 (js/cmmcell.js) — 셀 구성(남쪽 로봇 1대 + 측정실·리워크기 이송 6축), 공정 순서(정상품 · 재가공 · 접촉 리워크)와 문·브리지 구간,
// 피지컬AI ① 범용 파지(VLA) · ② 접촉 리워크 · ④ 온도 보정이 단계별로 다르게 기록되는지, 측정실 센서값 · 데이터(MQTT 토픽) · 품질 표본 값을 확인한다 (셀 애니메이션·간섭은 tools/check-sweeps.cjs). 실행: npm test
import { Simulation } from '../js/sim.js';
import { CMM_SPEC, CMM_SENSORS, CMM_TOPIC, CMM_PLANS, cmmPlan, cmmPhase, cmmDoorK, cmmBridgeOn } from '../js/cmmcell.js';
import { EXTRA_ZONES, zoneCellAux } from '../js/zonedefs.js';
import { normalizeRecipe, defaultRecipe } from '../js/zonerecipe.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const run = (M, n, product = 'hblock', rework = false, from = 0) => Array.from({ length: n }, (_, k) => { const it = { id: `ADP-${from + k}`, product, rework }; M.plan(it); M.done(it); return it; });

console.log('== 구성');
const Z = EXTRA_ZONES.find((z) => z.key === 'adapt'), D = Z.cells.CMM;
check('CMM 셀: 남쪽 협동로봇 1대(자동화) / 양팔 로봇 1대(피지컬AI) + 측정실·리워크기 이송 6축 (레거시는 없음)', D.robot.join() === 'cobot,1,ammr,1' && D.aux?.[0] === 'articulated' && zoneCellAux(D, 'dark') === 1 && zoneCellAux(D, 'smart') === 1 && zoneCellAux(D, 'traditional') === 0);
check('리워크는 셀 시간 2배 (1차 측정 → 리워크 → 재측정)', Z.rework.at === 'CMM' && Z.rework.mul === 2);
const R = normalizeRecipe({ ...defaultRecipe('adapt'), cells: defaultRecipe('adapt').cells.map((c) => (c.id === 'CMM' ? { ...c, robot: { kind: 'articulated', count: 3 } } : c)) }), rc = R.recipe.cells.find((c) => c.id === 'CMM');
check('공정 설계: CMM 셀 로봇은 협동로봇 1대 고정', rc.robot.kind === 'cobot' && rc.robot.count === 1 && R.warnings.length >= 1, R.warnings.join(' / '));
check('센서 6종 · 소재 2종 열팽창 계수', CMM_SENSORS.length === 6 && CMM_SPEC.mat.hblock.alpha > 0 && CMM_SPEC.mat.rcover.alpha > CMM_SPEC.mat.hblock.alpha);

console.log('== 공정 순서 (진행률)');
for (const [k, P] of Object.entries(CMM_PLANS)) {
  const mono = P.seq.every((e, i) => !i || e[0] >= P.seq[i - 1][0]), ends = P.seq[0][1] === 'tuckA' && P.seq.at(-1)[0] === 1 && P.seq.at(-1)[2] === 'amr';
  // 측정·재가공 중에는 그 문이 닫혀 있고, 브리지는 측정 구간에만 지그 위 · 이송 6축이 측정실 안 경유점에 있을 때 문은 다 열려 있다
  const shut = (R2, D2) => R2.every(([a, b]) => [a + 0.003, (a + b) / 2, b - 0.003].every((p) => cmmDoorK(p, D2) === 0));
  const inside = P.seq.filter((e) => e[1] === 'cmm' || e[1] === 'mc').every((e) => cmmDoorK(e[0], P.doors[e[1]]) === 1);
  const bridgeOut = P.doors.cmm.every(([a, b]) => !cmmBridgeOn(P, a + 0.011) && !cmmBridgeOn(P, b - 0.011));
  check(`${k}: 경로가 시간순 · tuckA에서 시작해 AMR 지그로 끝남 · 측정${P.mc ? '·재가공' : ''} 중 문 닫힘 · 역 안에서는 문 열림 · 문이 열려 있을 때 브리지 비킴`, mono && ends && shut(P.meas, P.doors.cmm) && (!P.mc || shut([P.mc], P.doors.mc)) && inside && bridgeOut);
}
check('정상품: 측정 1회 · 리워크 구간 없음', CMM_PLANS.ok.meas.length === 1 && !CMM_PLANS.ok.mc && !CMM_PLANS.ok.hand && CMM_PLANS.ok.doors.mc.length === 0);
check('재가공: 측정실 → 머시닝센터 → 측정실 (재측정)', CMM_PLANS.mc.meas.length === 2 && CMM_PLANS.mc.seq.some((e) => e[2] === 'mc') && CMM_PLANS.mc.mc[0] > CMM_PLANS.mc.meas[0][1] && CMM_PLANS.mc.mc[1] < CMM_PLANS.mc.meas[1][0]);
const H = CMM_PLANS.hand, amrBetween = H.seq.filter((e) => e[0] > H.meas[0][1] && e[0] < H.meas[1][0] && e[2] === 'amr');
check('접촉 리워크: 1차 측정 뒤 AMR 지그로 돌려놓고 남쪽 로봇 작업 → 재측정 (머시닝센터 안 감)', H.doors.mc.length === 0 && amrBetween.length > 0 && H.hand[0] > H.meas[0][1] && H.hand[1] < H.meas[1][0]);
check('단계 이름', cmmPhase(CMM_PLANS.ok, 0.05) === 'blow' && cmmPhase(CMM_PLANS.ok, 0.5) === 'meas' && cmmPhase(CMM_PLANS.ok, 0.72) === 'mark' && cmmPhase(CMM_PLANS.mc, 0.55) === 'mc' && cmmPhase(CMM_PLANS.mc, 0.8) === 'remeas' && cmmPhase(H, 0.55) === 'hand');
check('계획이 없는 소재: 리워크면 재가공 · 아니면 정상품', cmmPlan({ rework: true }) === CMM_PLANS.mc && cmmPlan({}) === CMM_PLANS.ok && cmmPlan(null) === CMM_PLANS.ok);

console.log('== 피지컬AI · 자동화 · 레거시');
const sd = new Simulation('dark', 11, { quiet: true }), sm = new Simulation('smart', 11, { quiet: true }), sl = new Simulation('traditional', 11, { quiet: true });
const sent = []; sd.machmon.onItem = (x) => sent.push(x);
const dk = run(sd.cmm, 40), at = run(sm.cmm, 40), lg = run(sl.cmm, 20);
const avg = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
check('④ 온도 보정: AI 남은 오차 < 1µm · 선형식은 열팽창의 6~10% · 레거시는 보정 없음', dk.every((it) => it.cmm.residual < 1) && at.every((it) => it.cmm.residual >= it.cmm.raw * 0.06 - 0.01 && it.cmm.residual <= it.cmm.raw * 0.1 + 0.01) && lg.every((it) => !it.cmm.comp && it.cmm.residual === it.cmm.raw),
  `AI ${avg(dk, (x) => x.cmm.residual).toFixed(2)}µm · 선형 ${avg(at, (x) => x.cmm.residual).toFixed(1)}µm · 레거시 ${avg(lg, (x) => x.cmm.residual).toFixed(1)}µm`);
check('소재 온도: 유압블록(60℃ 세척 직후)이 리어커버보다 높음 · 20℃ 위', avg(dk, (x) => x.cmm.temp) > avg(run(sd.cmm, 40, 'rcover', false, 100), (x) => x.cmm.temp) && dk.every((it) => it.cmm.temp > 20));
check('① 범용 파지: 피지컬AI = VLA(후보 여러 개 · 신뢰도) · 자동화 = 티칭 · 레거시 = 작업자', dk.every((it) => it.cmm.grasp.method === 'VLA' && it.cmm.grasp.candidates >= 6 && it.cmm.grasp.conf >= 0.93) && at.every((it) => it.cmm.grasp.method === 'teach') && lg.every((it) => it.cmm.grasp.method === 'manual' && it.cmm.force == null));
check('① 지그 핀 끼움: 힘 제어(피지컬AI)가 위치 제어(자동화)보다 낮은 힘', avg(dk, (x) => x.cmm.force) < avg(at, (x) => x.cmm.force) - 10, `${avg(dk, (x) => x.cmm.force).toFixed(1)}N vs ${avg(at, (x) => x.cmm.force).toFixed(1)}N`);
const rw = run(sd.cmm, 200, 'hblock', true, 200), hand = rw.filter((it) => it.cmm.kind === 'hand').length;
check('② 리워크 갈래: 접촉 리워크 약 35% · 나머지 머시닝센터 재가공', rw.every((it) => it.cmm.kind === 'hand' || it.cmm.kind === 'mc') && hand > 45 && hand < 95, `접촉 ${hand}/200`);
check('측정 기록 · 품질 표본 값 · MQTT (…/part)', sd.cmm.records.length === 60 && dk.every((it) => it.qx?.cmm?.temp > 20) && sent.filter((x) => x.topic === `${CMM_TOPIC}/part`).length >= 40 && sd.cmm.stats.vla >= 40);
check('레거시: 데이터 전송 없음', !sl.cmm.on && sl.cmm.ai === false);

console.log('== 측정실 센서값');
const it = { id: 'ADP-X', product: 'hblock' }; sd.cmm.plan(it);
const cell = { id: 'CMM', state: 'BUSY', progress: 0.5, fault: null, halt: false, item: it };
sd.xzones = { byKey: (k) => (k === 'adapt' ? { cells: { CMM: cell } } : null) };
sd.cmm.acc = 1; sd.cmm.tick(0); const meas = { ...sd.cmm.latest };
cell.progress = 0.3; sd.cmm.acc = 1; sd.cmm.tick(0); const door = { ...sd.cmm.latest };
check('측정 중: 측정실 20±0.5℃ · 소재 온도 표시 · 공기 베어링 0.5MPa', meas.phase === 'meas' && Math.abs(meas.room - 20) < 0.5 && meas.part > 20 && Math.abs(meas.air - 0.5) < 0.03, JSON.stringify(meas));
check('문이 열린 동안 측정실 온도·상하 온도차가 조금 오름 · 끼움 힘 기록', door.phase === 'load' && door.grad > meas.grad && door.force > 0, `${door.room}℃ · ${door.grad}℃/m · ${door.force}N`);
check('센서 경보 판정', sd.cmm.level(CMM_SENSORS[0], 21.2) === 'alarm' && sd.cmm.level(CMM_SENSORS[0], 20.1) === 'ok' && sd.cmm.level(CMM_SENSORS[5], 65) === 'warn');

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
