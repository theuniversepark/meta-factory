// 적응가공 유압블록 세척기 검증 (js/washer.js) — 필터가 막히고 세척액이 오염될수록 청정도가 나빠져 재세척이 늘고,
// 차압이 요청선을 넘으면 필터 교체 정비 요청 → 정비 인력이 필터 유닛 앞으로 출동 → 교체(셀 정지) → 차압 회복 · FAC 설비보전 기록,
// 레거시는 차압 센서가 없어 경보선에서 교체, 세척 단계별 센서값, 데이터(MQTT 토픽) · CMM 품질 표본 · 세척기 진행률을 확인한다. 실행: npm test
import { Simulation, MAINT_KO } from '../js/sim.js';
import { WASH_SPEC, WASH_SENSORS, WASH_TOPIC, washQ, washPhase, boothPhase } from '../js/washer.js';
import { QSPEC } from '../js/zonekpi.js';
import { EXTRA_ZONES, zoneCellAux } from '../js/zonedefs.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const items = (W, n, from = 0) => { const out = []; for (let k = 0; k < n; k++) { const it = { id: `ADP-${from + k}`, product: 'hblock' }; W.plan(it); W.done(it); out.push(it); } return out; };

console.log('== 구성');
const D = EXTRA_ZONES.find((z) => z.key === 'adapt').cells.HB_DEBR;
check('유압블록 디버링셀: 셀 로봇 = 텐딩 6축 1대 · 부스·세척기 이송 6축 1대 (레거시는 없음)', D.wash === true && D.robot.join() === 'articulated,1' && zoneCellAux(D, 'dark') === 1 && zoneCellAux(D, 'smart') === 1 && zoneCellAux(D, 'traditional') === 0);
check('센서 6종 · 정비 종류 이름', WASH_SENSORS.length === 6 && MAINT_KO.filter === '세척기 필터 교체');
check('Zone 대시보드 품질 특성에 청정도 (최대 입자 · 잔류 오염량)', QSPEC.adapt.particle?.usl === WASH_SPEC.maxParticle && QSPEC.adapt.residue?.usl === WASH_SPEC.maxResidue);
check('이송 진행률: 머신텐딩(앞 절반) 동안 0 · 뒤 절반 0 ~ 1', washQ(0.3) === 0 && washQ(0.5) === 0 && Math.abs(washQ(0.75) - 0.5) < 1e-9 && washQ(1) === 1);
check('세척 단계: 고압 분사 → 랜스 세척 → 건조 (부스 워터젯 디버링 뒤)', washPhase(0.73) === 'hp' && washPhase(0.78) === 'lance' && washPhase(0.82) === 'dry' && washPhase(0.35) === null && washPhase(0.9) === null && boothPhase(0.35) === 'wj' && boothPhase(0.73) === null);

console.log('== 새 필터: 청정도 규격 안 · 재세척 드묾');
const s = new Simulation('dark', 11, { quiet: true }), W = s.washer, fac = s.zoneCell('adapt', 'HB_DEBR');
const sent = []; s.machmon.onItem = (x) => sent.push(x);
const first = items(W, 40);
const rw0 = first.filter((it) => it.wash.passes > 1).length;
check('새 필터 40개 — 재세척 10% 미만 · 모두 최종 규격 안', rw0 < 4 && first.every((it) => it.wash.pass), `재세척 ${rw0}개`);
check('블록마다 청정도 기록 · CMM 품질 표본용 값', W.records.length === 40 && first.every((it) => it.qx?.wash?.particle > 0 && it.qx.wash.residue > 0) && W.records[0].spec.standard.includes('ISO 16232'));
check('필터 차압 · 세척액 전도도가 세척할수록 오름', W.dp > WASH_SPEC.dp0 + 0.15 && W.cond > WASH_SPEC.cond0 + 30, `차압 ${W.dp.toFixed(3)}bar · 전도도 ${W.cond.toFixed(0)}µS/cm`);
check('세척 기록 MQTT (…/part)', sent.filter((x) => x.topic === `${WASH_TOPIC}/part`).length === 40);

console.log('== 필터 막힘 → 재세척 증가 → 정비 요청');
let reqAt = null; const mid = [];
for (let k = 0; k < 200 && !fac.request; k++) { mid.push(...items(W, 1, 100 + k)); if (fac.request) reqAt = W.dp; }
const late = mid.slice(-25), rwLate = late.filter((it) => it.wash.passes > 1).length;
check('차압 요청선(0.9bar)에서 필터 교체 정비 요청', fac.request?.kind === 'filter' && reqAt >= WASH_SPEC.dpRequest && reqAt < WASH_SPEC.dpRequest + 0.05, `요청 때 차압 ${reqAt?.toFixed(3)}bar`);
check('막히기 직전 25개 재세척이 새 필터 때보다 많음 (IoT는 그래도 소수)', rwLate > 0 && rwLate / 25 > rw0 / 40 && rwLate <= 12, `새 필터 ${rw0}/40 → 막힘 ${rwLate}/25`);
check('정비 요청 이벤트 · 로그 · FAC 정비요청 (세척기 백필터 교체)', W.events[0]?.kind === 'request' && sent.some((x) => x.topic === `${WASH_TOPIC}/event`) && s.fac.db.mr.some((m) => m.name.includes('세척기 백필터 교체')));
check('필터 교체는 필터 유닛 앞(세척기 동쪽)으로 · 점검 자리는 세척기 반대쪽', fac.svcWash && fac.svcWash.x > fac.x + 4.5 && fac.scan.x < fac.svc.x, `필터 유닛 앞 (${fac.svcWash?.x.toFixed(1)}, ${fac.svcWash?.z.toFixed(1)})`);

console.log('== 정비 인력 출동 → 교체 → 차압 회복');
const dpBefore = W.dp; let maintSeen = false, t = 0;
while (t < 900 && fac.request) { s.step(0.5); t += 0.5; if (fac.state === 'MAINT' && fac.maintKind === 'filter') maintSeen = true; }
check('정비 인력 도착 → 셀 정비(필터 교체) 상태 → 완료', maintSeen && !fac.request && fac.state === 'OK', `${t.toFixed(0)}초`);
check('필터 교체 뒤 차압이 새 필터 수준 · 교체 기록', W.dp < WASH_SPEC.dp0 + 0.05 && W.stats.filterChanges === 1 && W.events[0].kind === 'replaced' && s.stats.washFilter === 1, `${dpBefore.toFixed(2)} → ${W.dp.toFixed(2)}bar`);
const mr = s.fac.db.mr.find((m) => m.name.includes('세척기 백필터 교체'));
check('FAC 정비요청 완료 처리', mr && mr.stage === 'done', mr?.stage);
const after = items(W, 30, 500);
check('교체 뒤 재세척이 다시 줄어듦', after.filter((it) => it.wash.passes > 1).length / 30 <= rwLate / 25, `${after.filter((it) => it.wash.passes > 1).length}/30`);

console.log('== 세척액 오염 → 필터 교체 때 세척액도 교체');
W.cond = WASH_SPEC.condBath + 50; W.maintained();
check('전도도 기준 초과면 세척액 교체', W.cond < WASH_SPEC.cond0 + 30 && W.stats.bathChanges === 1);

console.log('== 세척 단계별 센서값');
const cell = { id: 'HB_DEBR', state: 'BUSY', progress: 0.865, fault: null, halt: false };   // q 0.73 → 고압 분사 세척
s.xzones = { byKey: (k) => (k === 'adapt' ? { cells: { HB_DEBR: cell } } : null) };
W.acc = 1; W.tick(0); const hp = { ...W.latest };
cell.progress = 0.91; W.acc = 1; W.tick(0); const dry = { ...W.latest };
cell.state = 'IDLE'; W.acc = 1; W.tick(0); const idle = { ...W.latest };
check('고압 분사 세척 중 압력 ≈ 600bar · 유량 ≈ 120L/min', hp.phase === 'hp' && hp.pressure > 560 && hp.flow > 110, `${hp.pressure}bar · ${hp.flow}L/min`);
check('건조 중 열풍 ≈ 80°C · 펌프 멈춤', dry.phase === 'dry' && dry.dryTemp > 75 && dry.pressure < 10, `${dry.dryTemp}°C`);
check('대기 중 압력·유량 0 근처 · 경보 없음', idle.pressure < 10 && idle.flow === 0 && Object.values(W.levels).every((l) => l === 'ok'));
W.dp = 1.25; cell.state = 'BUSY'; cell.progress = 0.865; W.acc = 1; W.tick(0);
check('차압 경보 · 막힌 필터로 압력 떨어짐', W.levels.dp === 'alarm' && W.latest.pressure < 560, `${W.latest.pressure}bar`);
check('샘플 MQTT (5초)', sent.some((x) => x.topic === WASH_TOPIC && x.kind === 'sample'));

console.log('== 레거시: 차압 센서 없음 → 경보선에서 교체 · 데이터 수집 없음');
const L = new Simulation('traditional', 11, { quiet: true }), WL = L.washer, fl = L.zoneCell('adapt', 'HB_DEBR'), sentL = [];
L.machmon.onItem = (x) => sentL.push(x);
let dpReqL = null; const legacy = []; for (let k = 0; k < 400 && !fl.request; k++) { legacy.push(...items(WL, 1, k)); if (fl.request) dpReqL = WL.dp; }
const rwL = legacy.slice(-25).filter((it) => it.wash.passes > 1).length;
check('레거시는 경보선(1.2bar)에서 교체 요청 — IoT보다 늦음', fl.request?.kind === 'filter' && dpReqL >= WASH_SPEC.dpAlarm, `${dpReqL?.toFixed(3)}bar`);
check('레거시는 세척 데이터 전송 없음', !WL.on && sentL.length === 0);
check('레거시는 교체가 늦어 재세척이 IoT보다 훨씬 많음', rwL > rwLate * 1.5, `교체 직전 25개 재세척 IoT ${rwLate} · 레거시 ${rwL}`);

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
if (fail) process.exit(1);
